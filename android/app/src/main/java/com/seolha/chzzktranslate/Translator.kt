package com.seolha.chzzktranslate

import android.util.LruCache
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.atomic.AtomicInteger

/**
 * 무료 번역: Google 번역 공개 엔드포인트(키 불필요)를 먼저 쓰고,
 * 실패하면 MyMemory 무료 API로 대체한다.
 */
object Translator {
    data class Result(val text: String, val detected: String)

    private val cache = LruCache<String, Result>(1500)
    private val chatGate = Semaphore(3)
    private val speechGate = Semaphore(2)
    private val pendingChat = AtomicInteger(0)

    /** 채팅이 폭주할 때 번역 대기열이 끝없이 쌓이지 않도록 하는 한도 */
    private const val MAX_PENDING_CHAT = 40

    fun worthTranslating(text: String): Boolean = text.any { it.isLetter() }

    fun sameLang(detected: String, target: String): Boolean {
        if (detected.isBlank()) return false
        val a = detected.lowercase()
        val b = target.lowercase()
        if (a.startsWith("zh") && b.startsWith("zh")) return a == b
        return a.substringBefore('-') == b.substringBefore('-')
    }

    /**
     * @param source 원문 언어 코드, 모르면 "auto"
     * @param priority true면 자막(음성) 번역: 별도 통로로 처리하고 대기열 한도를 적용하지 않는다.
     */
    suspend fun translate(
        text: String,
        target: String,
        source: String = "auto",
        priority: Boolean = false
    ): Result? {
        val q = text.trim()
        if (q.isEmpty()) return null
        val key = "$source>$target|$q"
        cache.get(key)?.let { return it }

        if (!priority && pendingChat.get() >= MAX_PENDING_CHAT) return null
        if (!priority) pendingChat.incrementAndGet()
        try {
            val gate = if (priority) speechGate else chatGate
            val result = gate.withPermit {
                runCatching { google(q, target, source) }.getOrNull()
                    ?: runCatching { myMemory(q, target, source) }.getOrNull()
            } ?: return null
            if (result.text.isBlank()) return null
            cache.put(key, result)
            return result
        } finally {
            if (!priority) pendingChat.decrementAndGet()
        }
    }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    private suspend fun google(q: String, target: String, source: String): Result {
        val url = "https://translate.googleapis.com/translate_a/single?client=gtx&dt=t" +
            "&sl=${enc(source)}&tl=${enc(target)}&q=${enc(q)}"
        val root = JSONArray(Http.getString(url))
        val parts = root.getJSONArray(0)
        val sb = StringBuilder()
        for (i in 0 until parts.length()) {
            val seg = parts.optJSONArray(i) ?: continue
            if (seg.isNull(0)) continue
            sb.append(seg.optString(0))
        }
        val detected = if (root.length() > 2 && !root.isNull(2)) root.optString(2) else source
        return Result(sb.toString().trim(), detected)
    }

    private suspend fun myMemory(q: String, target: String, source: String): Result {
        val src = if (source == "auto") "autodetect" else source
        val url = "https://api.mymemory.translated.net/get?q=${enc(q)}&langpair=${enc("$src|$target")}"
        val root = JSONObject(Http.getString(url))
        if (root.optInt("responseStatus", 0) != 200) throw IllegalStateException("MyMemory 오류")
        val text = root.optJSONObject("responseData")?.optString("translatedText").orEmpty()
        if (text.isBlank() || text.startsWith("MYMEMORY WARNING")) throw IllegalStateException("MyMemory 한도")
        return Result(text.trim(), if (source == "auto") "" else source)
    }
}
