package com.seolha.chzzktranslate

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicLong

data class ChatMessage(
    val id: Long,
    val nick: String,
    val text: String,
    val donation: Boolean,
    val amount: Int,
    var translation: String? = null
)

/**
 * 치지직 채팅 서버(웹소켓)에 읽기 전용으로 접속해 채팅을 받아온다.
 * 연결이 끊기면 지수 백오프로 자동 재접속한다.
 */
class ChatClient(
    private val chatChannelId: String,
    private val scope: CoroutineScope,
    private val listener: Listener
) {
    interface Listener {
        fun onMessages(messages: List<ChatMessage>)
        fun onChatStatus(text: String)
    }

    private companion object {
        const val CMD_PING = 0
        const val CMD_PONG = 10000
        const val CMD_CONNECT = 100
        const val CMD_CONNECTED = 10100
        const val CMD_REQUEST_RECENT = 5101
        const val CMD_RECENT = 15101
        const val CMD_CHAT = 93101
        const val CMD_DONATION = 93102
        val EMOTE = Regex("\\{:[^{}:]+:\\}")
        val ids = AtomicLong(1)
    }

    @Volatile private var socket: WebSocket? = null
    @Volatile private var closed = false
    private var job: Job? = null

    fun start() {
        job = scope.launch(Dispatchers.IO) {
            var backoff = 2000L
            while (isActive && !closed) {
                try {
                    val token = ChzzkApi.chatAccessToken(chatChannelId)
                    val finished = CompletableDeferred<Unit>()
                    connect(token, finished)
                    val pinger = launch {
                        while (isActive) {
                            delay(20_000)
                            socket?.send(JSONObject().put("ver", "2").put("cmd", CMD_PONG).toString())
                        }
                    }
                    finished.await()
                    pinger.cancel()
                    backoff = 2000L
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    listener.onChatStatus("채팅 연결 실패: ${e.message ?: "알 수 없는 오류"}")
                }
                if (closed) break
                listener.onChatStatus("채팅 재연결 중…")
                delay(backoff)
                backoff = (backoff * 2).coerceAtMost(30_000L)
            }
        }
    }

    fun close() {
        closed = true
        socket?.close(1000, null)
        socket = null
        job?.cancel()
    }

    private fun connect(token: String, finished: CompletableDeferred<Unit>) {
        val server = (chatChannelId.sumOf { it.code } % 9) + 1
        val request = Request.Builder()
            .url("wss://kr-ss$server.chat.naver.com/chat")
            .header("Origin", "https://chzzk.naver.com")
            .build()

        socket = Http.client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                val body = JSONObject()
                    .put("uid", JSONObject.NULL)
                    .put("devType", 2001)
                    .put("accTkn", token)
                    .put("auth", "READ")
                val msg = JSONObject()
                    .put("ver", "2")
                    .put("cmd", CMD_CONNECT)
                    .put("svcid", "game")
                    .put("cid", chatChannelId)
                    .put("bdy", body)
                    .put("tid", 1)
                webSocket.send(msg.toString())
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    handle(webSocket, JSONObject(text))
                } catch (_: Exception) {
                    // 알 수 없는 형식의 패킷은 무시
                }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                finished.complete(Unit)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                finished.complete(Unit)
            }
        })
    }

    private fun handle(ws: WebSocket, o: JSONObject) {
        when (o.optInt("cmd", -1)) {
            CMD_PING -> ws.send(JSONObject().put("ver", "2").put("cmd", CMD_PONG).toString())

            CMD_CONNECTED -> {
                listener.onChatStatus("채팅 연결됨")
                val sid = o.optJSONObject("bdy")?.optString("sid").orEmpty()
                val req = JSONObject()
                    .put("ver", "2")
                    .put("cmd", CMD_REQUEST_RECENT)
                    .put("svcid", "game")
                    .put("cid", chatChannelId)
                    .put("sid", sid)
                    .put("bdy", JSONObject().put("recentMessageCount", 30))
                    .put("tid", 2)
                ws.send(req.toString())
            }

            CMD_CHAT, CMD_DONATION -> {
                val arr = o.optJSONArray("bdy") ?: return
                val donation = o.optInt("cmd") == CMD_DONATION
                emit(arr, donation)
            }

            CMD_RECENT -> {
                val arr = o.optJSONObject("bdy")?.optJSONArray("messageList") ?: return
                val items = (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }
                    .sortedBy { it.optLong("createTime", it.optLong("msgTime", 0L)) }
                val sorted = JSONArray()
                items.forEach { sorted.put(it) }
                emit(sorted, false)
            }
        }
    }

    private fun emit(arr: JSONArray, donationCmd: Boolean) {
        val out = ArrayList<ChatMessage>(arr.length())
        for (i in 0 until arr.length()) {
            val item = arr.optJSONObject(i) ?: continue
            parse(item, donationCmd)?.let { out.add(it) }
        }
        if (out.isNotEmpty()) listener.onMessages(out)
    }

    private fun parse(o: JSONObject, donationCmd: Boolean): ChatMessage? {
        val raw = when {
            o.has("msg") && !o.isNull("msg") -> o.optString("msg")
            o.has("content") && !o.isNull("content") -> o.optString("content")
            else -> ""
        }
        val text = EMOTE.replace(raw, "").trim()
        if (text.isEmpty()) return null

        val typeCode = o.optInt("msgTypeCode", o.optInt("messageTypeCode", 1))
        val donation = donationCmd || typeCode == 10

        var nick = if (donation) "익명 후원" else "익명"
        val profile = o.optString("profile")
        if (profile.startsWith("{")) {
            try {
                JSONObject(profile).optString("nickname").takeIf { it.isNotBlank() }?.let { nick = it }
            } catch (_: Exception) {
            }
        }

        var amount = 0
        val extras = o.optString("extras")
        if (donation && extras.startsWith("{")) {
            try {
                amount = JSONObject(extras).optInt("payAmount", 0)
            } catch (_: Exception) {
            }
        }
        return ChatMessage(ids.getAndIncrement(), nick, text, donation, amount)
    }
}
