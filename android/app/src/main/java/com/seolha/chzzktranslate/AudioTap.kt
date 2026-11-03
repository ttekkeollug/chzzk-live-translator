package com.seolha.chzzktranslate

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.audio.TeeAudioProcessor
import java.nio.ByteBuffer

/**
 * 플레이어가 실제로 재생하는 PCM 오디오를 가로채 음성 인식기로 넘겨주는 중계기.
 * 화면 녹화 권한 없이 방송 소리만 정확히 얻을 수 있고, 재생 타이밍과 자막이 맞는다.
 */
@OptIn(UnstableApi::class)
class AudioTap : TeeAudioProcessor.AudioBufferSink {
    @Volatile private var format: IntArray? = null

    @Volatile
    var target: TeeAudioProcessor.AudioBufferSink? = null
        set(value) {
            field = value
            val f = format
            if (value != null && f != null) value.flush(f[0], f[1], f[2])
        }

    override fun flush(sampleRateHz: Int, channelCount: Int, encoding: Int) {
        format = intArrayOf(sampleRateHz, channelCount, encoding)
        target?.flush(sampleRateHz, channelCount, encoding)
    }

    override fun handleBuffer(buffer: ByteBuffer) {
        target?.handleBuffer(buffer)
    }
}

@OptIn(UnstableApi::class)
class TapRenderersFactory(
    context: Context,
    private val tap: AudioTap
) : DefaultRenderersFactory(context) {
    override fun buildAudioSink(
        context: Context,
        enableFloatOutput: Boolean,
        enableAudioTrackPlaybackParams: Boolean
    ): AudioSink {
        return DefaultAudioSink.Builder(context)
            .setEnableFloatOutput(enableFloatOutput)
            .setEnableAudioTrackPlaybackParams(enableAudioTrackPlaybackParams)
            .setAudioProcessors(arrayOf<AudioProcessor>(TeeAudioProcessor(tap)))
            .build()
    }
}
