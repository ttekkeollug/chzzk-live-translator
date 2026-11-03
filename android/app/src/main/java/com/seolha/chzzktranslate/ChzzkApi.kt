package com.seolha.chzzktranslate

import org.json.JSONObject
import java.io.IOException

data class LiveInfo(
    val channelId: String,
    val channelName: String,
    val title: String,
    val isOpen: Boolean,
    val adult: Boolean,
    val hlsUrl: String?,
    val chatChannelId: String?
)

object ChzzkApi {
    private val CHANNEL_ID = Regex("[0-9a-fA-F]{32}")

    /** 채널 주소(https://chzzk.naver.com/live/ID 등), 공유 문구, 또는 ID 자체에서 채널 ID를 뽑아낸다. */
    fun parseChannelId(input: String?): String? =
        input?.let { CHANNEL_ID.find(it)?.value?.lowercase() }

    private fun JSONObject.str(key: String): String? {
        if (!has(key) || isNull(key)) return null
        return optString(key).takeIf { it.isNotBlank() && it != "null" }
    }

    suspend fun liveDetail(channelId: String): LiveInfo {
        val body = Http.getString(
            "https://api.chzzk.naver.com/service/v3/channels/$channelId/live-detail",
            Http.CHZZK_HEADERS
        )
        val root = JSONObject(body)
        val content = root.optJSONObject("content")
            ?: throw IOException("방송 정보를 찾을 수 없습니다 (채널 ID 확인)")

        val channelName = content.optJSONObject("channel")?.str("channelName") ?: ""
        val title = content.str("liveTitle") ?: ""
        val status = content.str("status") ?: ""
        val adult = content.optBoolean("adult", false)
        val chatChannelId = content.str("chatChannelId")

        var hls: String? = null
        val playback = content.str("livePlaybackJson")
        if (playback != null) {
            val media = JSONObject(playback).optJSONArray("media")
            if (media != null) {
                var fallback: String? = null
                for (i in 0 until media.length()) {
                    val m = media.optJSONObject(i) ?: continue
                    val path = m.str("path") ?: continue
                    if (m.optString("mediaId") == "HLS") hls = path
                    if (fallback == null) fallback = path
                }
                if (hls == null) hls = fallback
            }
        }

        return LiveInfo(
            channelId = channelId,
            channelName = channelName,
            title = title,
            isOpen = status.equals("OPEN", ignoreCase = true),
            adult = adult,
            hlsUrl = hls,
            chatChannelId = chatChannelId
        )
    }

    suspend fun chatAccessToken(chatChannelId: String): String {
        val body = Http.getString(
            "https://comm-api.game.naver.com/nng_main/v1/chats/access-token" +
                "?channelId=$chatChannelId&chatType=STREAMING",
            Http.CHZZK_HEADERS
        )
        val content = JSONObject(body).optJSONObject("content")
            ?: throw IOException("채팅 토큰을 받지 못했습니다")
        return content.str("accessToken") ?: throw IOException("채팅 토큰이 비어 있습니다")
    }
}
