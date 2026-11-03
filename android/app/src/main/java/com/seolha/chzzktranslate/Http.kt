package com.seolha.chzzktranslate

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException
import java.util.concurrent.TimeUnit

object Http {
    const val USER_AGENT =
        "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) " +
            "Chrome/130.0.0.0 Mobile Safari/537.36"

    val CHZZK_HEADERS = mapOf(
        "Referer" to "https://chzzk.naver.com/",
        "Origin" to "https://chzzk.naver.com"
    )

    val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .addInterceptor { chain ->
                val req = chain.request()
                val out = if (req.header("User-Agent") == null) {
                    req.newBuilder().header("User-Agent", USER_AGENT).build()
                } else req
                chain.proceed(out)
            }
            .build()
    }

    suspend fun getString(url: String, headers: Map<String, String> = emptyMap()): String =
        withContext(Dispatchers.IO) {
            val builder = Request.Builder().url(url)
            headers.forEach { (k, v) -> builder.header(k, v) }
            client.newCall(builder.build()).execute().use { res ->
                if (!res.isSuccessful) throw IOException("HTTP ${res.code}")
                res.body?.string() ?: throw IOException("빈 응답")
            }
        }
}
