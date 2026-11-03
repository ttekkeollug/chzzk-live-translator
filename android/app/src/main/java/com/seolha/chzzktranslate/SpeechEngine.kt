package com.seolha.chzzktranslate

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.audio.TeeAudioProcessor
import org.json.JSONObject
import org.vosk.LibVosk
import org.vosk.LogLevel
import org.vosk.Model
import org.vosk.Recognizer
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * 방송 오디오(PCM)를 16kHz 모노로 변환해 Vosk 오프라인 음성 인식기에 넣고,
 * 중간 결과(partial)와 문장 단위 결과(final)를 콜백으로 돌려준다.
 * 콜백은 백그라운드 스레드에서 호출된다.
 */
@OptIn(UnstableApi::class)
class SpeechEngine(
    private val modelPath: String,
    private val listener: Listener
) : TeeAudioProcessor.AudioBufferSink {

    interface Listener {
        fun onSpeechReady()
        fun onPartial(text: String)
        fun onFinal(text: String)
        fun onSpeechError(message: String)
    }

    private companion object {
        const val OUT_RATE = 16000
        /** 말이 끊기지 않고 이어질 때 강제로 문장을 끊는 시간 */
        const val MAX_SEGMENT_MS = 7000L
    }

    private val queue = ArrayBlockingQueue<ShortArray>(400)
    @Volatile private var running = false
    private var worker: Thread? = null

    // 입력 형식 (오디오 스레드에서 갱신)
    @Volatile private var inRate = 48000
    @Volatile private var inChannels = 2
    @Volatile private var inEncoding = C.ENCODING_PCM_16BIT
    @Volatile private var resetPending = true

    // 다운샘플러 상태 (오디오 스레드 전용)
    private var accSum = 0f
    private var accCount = 0
    private var phase = 0L

    fun start() {
        if (running) return
        running = true
        worker = Thread({ runLoop() }, "speech-recognizer").also { it.start() }
    }

    fun stop() {
        running = false
        worker?.interrupt()
        worker = null
        queue.clear()
    }

    override fun flush(sampleRateHz: Int, channelCount: Int, encoding: Int) {
        if (sampleRateHz > 0) inRate = sampleRateHz
        if (channelCount > 0) inChannels = channelCount
        inEncoding = encoding
        resetPending = true
    }

    override fun handleBuffer(buffer: ByteBuffer) {
        if (!running) return
        if (resetPending) {
            accSum = 0f; accCount = 0; phase = 0L
            resetPending = false
        }
        val b = buffer.duplicate().order(ByteOrder.LITTLE_ENDIAN)
        val ch = inChannels.coerceAtLeast(1)
        val rate = inRate.toLong()
        val bytesPerSample = when (inEncoding) {
            C.ENCODING_PCM_16BIT -> 2
            C.ENCODING_PCM_FLOAT -> 4
            else -> return
        }
        val frames = b.remaining() / (bytesPerSample * ch)
        if (frames <= 0) return

        val out = ShortArray((frames * OUT_RATE / rate).toInt() + 2)
        var n = 0
        for (i in 0 until frames) {
            var s = 0f
            for (c in 0 until ch) {
                s += if (bytesPerSample == 2) b.short.toFloat() else b.float * 32767f
            }
            accSum += s / ch
            accCount++
            phase += OUT_RATE
            if (phase >= rate) {
                phase -= rate
                if (n < out.size) {
                    val v = (accSum / accCount).toInt().coerceIn(-32768, 32767)
                    out[n++] = v.toShort()
                }
                accSum = 0f
                accCount = 0
            }
        }
        if (n > 0) queue.offer(out.copyOf(n))
    }

    private fun text(json: String, key: String): String =
        try {
            JSONObject(json).optString(key).trim()
        } catch (_: Exception) {
            ""
        }

    private fun runLoop() {
        var model: Model? = null
        var recognizer: Recognizer? = null
        try {
            LibVosk.setLogLevel(LogLevel.WARNINGS)
            model = Model(modelPath)
            recognizer = Recognizer(model, OUT_RATE.toFloat())
            listener.onSpeechReady()

            var lastPartial = ""
            var segmentStart = System.currentTimeMillis()
            while (running) {
                val chunk = queue.poll(300, TimeUnit.MILLISECONDS) ?: continue
                val now = System.currentTimeMillis()
                if (recognizer.acceptWaveForm(chunk, chunk.size)) {
                    val t = text(recognizer.result, "text")
                    if (t.isNotEmpty()) listener.onFinal(t)
                    lastPartial = ""
                    segmentStart = now
                } else {
                    val p = text(recognizer.partialResult, "partial")
                    if (p.isEmpty()) {
                        segmentStart = now
                    } else if (now - segmentStart > MAX_SEGMENT_MS) {
                        val t = text(recognizer.finalResult, "text")
                        if (t.isNotEmpty()) listener.onFinal(t)
                        lastPartial = ""
                        segmentStart = now
                        continue
                    }
                    if (p != lastPartial) {
                        lastPartial = p
                        listener.onPartial(p)
                    }
                }
            }
        } catch (_: InterruptedException) {
            // 정상 종료
        } catch (e: Throwable) {
            if (running) listener.onSpeechError(e.message ?: e.javaClass.simpleName)
        } finally {
            try { recognizer?.close() } catch (_: Throwable) {}
            try { model?.close() } catch (_: Throwable) {}
        }
    }
}
