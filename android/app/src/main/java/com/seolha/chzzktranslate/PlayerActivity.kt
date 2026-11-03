package com.seolha.chzzktranslate

import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.os.Bundle
import android.util.TypedValue
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import androidx.annotation.OptIn
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.ui.PlayerView
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.button.MaterialButton
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@OptIn(UnstableApi::class)
class PlayerActivity : AppCompatActivity(), ChatClient.Listener, SpeechEngine.Listener {

    companion object {
        const val EXTRA_CHANNEL_ID = "channel_id"
        private const val SUBTITLE_HIDE_MS = 6000L
        private val SCALES = floatArrayOf(1f, 1.25f, 1.5f, 0.85f)
    }

    private lateinit var prefs: Prefs
    private lateinit var root: LinearLayout
    private lateinit var videoBox: RatioFrameLayout
    private lateinit var playerView: PlayerView
    private lateinit var videoStatus: TextView
    private lateinit var subtitleBox: LinearLayout
    private lateinit var subOriginal: TextView
    private lateinit var subTranslated: TextView
    private lateinit var sidePanel: LinearLayout
    private lateinit var header: LinearLayout
    private lateinit var channelName: TextView
    private lateinit var liveTitle: TextView
    private lateinit var speechStatus: TextView
    private lateinit var chatStatus: TextView
    private lateinit var chatList: RecyclerView
    private lateinit var btnCc: MaterialButton
    private lateinit var btnChatTr: MaterialButton
    private lateinit var btnLang: MaterialButton
    private lateinit var btnRotate: MaterialButton

    private val adapter = ChatAdapter()
    private val tap = AudioTap()
    private var player: ExoPlayer? = null
    private var chat: ChatClient? = null
    private var speech: SpeechEngine? = null
    private var hideJob: Job? = null
    private var subtitleSeq = 0
    private var landscape = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_player)
        prefs = Prefs(this)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(window, false)

        root = findViewById(R.id.root)
        videoBox = findViewById(R.id.video_box)
        playerView = findViewById(R.id.player_view)
        videoStatus = findViewById(R.id.video_status)
        subtitleBox = findViewById(R.id.subtitle_box)
        subOriginal = findViewById(R.id.sub_original)
        subTranslated = findViewById(R.id.sub_translated)
        sidePanel = findViewById(R.id.side_panel)
        header = findViewById(R.id.header)
        channelName = findViewById(R.id.channel_name)
        liveTitle = findViewById(R.id.live_title)
        speechStatus = findViewById(R.id.speech_status)
        chatStatus = findViewById(R.id.chat_status)
        chatList = findViewById(R.id.chat_list)
        btnCc = findViewById(R.id.btn_cc)
        btnChatTr = findViewById(R.id.btn_chat_tr)
        btnLang = findViewById(R.id.btn_lang)
        btnRotate = findViewById(R.id.btn_rotate)

        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }

        chatList.layoutManager = LinearLayoutManager(this).apply { stackFromEnd = true }
        chatList.adapter = adapter
        chatList.itemAnimator = null

        btnCc.setOnClickListener {
            prefs.subtitleOn = !prefs.subtitleOn
            updateButtons()
            startSpeech()
        }
        btnChatTr.setOnClickListener {
            prefs.chatTranslate = !prefs.chatTranslate
            updateButtons()
            if (prefs.chatTranslate) retranslateRecent() else adapter.clearTranslations()
        }
        btnLang.setOnClickListener { chooseLanguage() }
        btnRotate.setOnClickListener {
            requestedOrientation = if (landscape) ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            else ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        }
        subtitleBox.setOnClickListener {
            val cur = SCALES.indexOfFirst { it == prefs.subtitleScale }.coerceAtLeast(0)
            prefs.subtitleScale = SCALES[(cur + 1) % SCALES.size]
            applySubtitleScale()
        }
        videoBox.setOnClickListener {
            if (landscape) {
                sidePanel.visibility =
                    if (sidePanel.visibility == View.VISIBLE) View.GONE else View.VISIBLE
            }
        }

        applySubtitleScale()
        updateButtons()
        applyOrientation(resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE)

        val channelId = intent.getStringExtra(EXTRA_CHANNEL_ID)
        if (channelId.isNullOrBlank()) {
            finish()
            return
        }
        lifecycleScope.launch { load(channelId) }
    }

    private suspend fun load(channelId: String) {
        videoStatus.visibility = View.VISIBLE
        videoStatus.text = getString(R.string.loading)
        val info = try {
            ChzzkApi.liveDetail(channelId)
        } catch (e: Exception) {
            videoStatus.text = getString(R.string.load_failed, e.message ?: "")
            return
        }
        channelName.text = info.channelName.ifBlank { channelId.take(8) }
        liveTitle.text = info.title
        prefs.addRecent(channelId, info.channelName)

        info.chatChannelId?.let { startChat(it) }
            ?: run { chatStatus.text = getString(R.string.chat_unavailable) }

        val url = info.hlsUrl
        when {
            !info.isOpen -> videoStatus.text = getString(R.string.not_live)
            url == null -> videoStatus.text =
                getString(if (info.adult) R.string.adult_blocked else R.string.no_stream)
            else -> {
                videoStatus.visibility = View.GONE
                startPlayer(url)
                startSpeech()
            }
        }
    }

    // ---------------- 영상 ----------------

    private fun startPlayer(url: String) {
        val dataSource = OkHttpDataSource.Factory(Http.client)
            .setDefaultRequestProperties(Http.CHZZK_HEADERS)
        val source = HlsMediaSource.Factory(dataSource)
            .createMediaSource(MediaItem.fromUri(url))
        val p = ExoPlayer.Builder(this, TapRenderersFactory(this, tap)).build()
        p.setMediaSource(source)
        p.addListener(object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                videoStatus.visibility = View.VISIBLE
                videoStatus.text = getString(R.string.playback_retry)
                lifecycleScope.launch {
                    delay(3000)
                    player?.let {
                        it.seekToDefaultPosition()
                        it.prepare()
                    }
                }
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                if (playbackState == Player.STATE_READY) videoStatus.visibility = View.GONE
            }
        })
        p.prepare()
        p.playWhenReady = true
        playerView.player = p
        player = p
    }

    // ---------------- 채팅 ----------------

    private fun startChat(chatChannelId: String) {
        chat?.close()
        chatStatus.text = getString(R.string.chat_connecting)
        chat = ChatClient(chatChannelId, lifecycleScope, this).also { it.start() }
    }

    override fun onMessages(messages: List<ChatMessage>) {
        runOnUiThread {
            val atBottom = !chatList.canScrollVertically(1)
            adapter.add(messages)
            if (atBottom) chatList.scrollToPosition(adapter.itemCount - 1)
            if (prefs.chatTranslate) messages.forEach { translateChat(it) }
        }
    }

    override fun onChatStatus(text: String) {
        runOnUiThread { chatStatus.text = text }
    }

    private fun translateChat(m: ChatMessage) {
        if (!Translator.worthTranslating(m.text)) return
        val target = prefs.targetLang
        lifecycleScope.launch {
            val r = Translator.translate(m.text, target) ?: return@launch
            if (!prefs.chatTranslate || target != prefs.targetLang) return@launch
            if (Translator.sameLang(r.detected, target)) return@launch
            if (r.text.equals(m.text, ignoreCase = true)) return@launch
            val atBottom = !chatList.canScrollVertically(1)
            m.translation = r.text
            adapter.refresh(m)
            if (atBottom) chatList.scrollToPosition(adapter.itemCount - 1)
        }
    }

    private fun retranslateRecent() {
        adapter.clearTranslations()
        adapter.recent(40).forEach { translateChat(it) }
    }

    // ---------------- 음성 자막 ----------------

    private fun startSpeech() {
        speech?.stop()
        speech = null
        tap.target = null
        hideSubtitle()
        if (!prefs.subtitleOn) {
            speechStatus.text = getString(R.string.speech_off)
            return
        }
        if (player == null) return
        val models = ModelManager(this)
        val lang = prefs.speechLang
        val path = if (models.isReady(lang)) models.modelPath(lang) else null
        if (path == null) {
            speechStatus.text = getString(
                R.string.speech_no_model, Languages.speechModel(lang).label
            )
            return
        }
        speechStatus.text = getString(R.string.speech_loading)
        val engine = SpeechEngine(path, this)
        speech = engine
        tap.target = engine
        engine.start()
    }

    override fun onSpeechReady() {
        runOnUiThread {
            speechStatus.text = getString(
                R.string.speech_running,
                Languages.speechModel(prefs.speechLang).label,
                Languages.target(prefs.targetLang).label
            )
        }
    }

    override fun onSpeechError(message: String) {
        runOnUiThread { speechStatus.text = getString(R.string.speech_error, message) }
    }

    override fun onPartial(text: String) {
        runOnUiThread {
            if (!prefs.subtitleOn || text.isEmpty()) return@runOnUiThread
            if (prefs.showOriginal) {
                subOriginal.text = text
                subOriginal.visibility = View.VISIBLE
                showSubtitleBox()
            }
        }
    }

    override fun onFinal(text: String) {
        runOnUiThread {
            if (!prefs.subtitleOn) return@runOnUiThread
            val seq = ++subtitleSeq
            if (prefs.showOriginal) {
                subOriginal.text = text
                subOriginal.visibility = View.VISIBLE
            } else {
                subOriginal.visibility = View.GONE
            }
            val source = prefs.speechLang
            val target = prefs.targetLang
            if (Translator.sameLang(source, target)) {
                showTranslated(text)
                return@runOnUiThread
            }
            showSubtitleBox()
            lifecycleScope.launch {
                val r = Translator.translate(text, target, source, priority = true)
                if (seq < subtitleSeq - 2) return@launch // 너무 오래된 문장은 버림
                showTranslated(r?.text ?: text)
            }
        }
    }

    private fun showTranslated(text: String) {
        subTranslated.text = text
        subTranslated.visibility = View.VISIBLE
        showSubtitleBox()
    }

    private fun showSubtitleBox() {
        subtitleBox.visibility = View.VISIBLE
        hideJob?.cancel()
        hideJob = lifecycleScope.launch {
            delay(SUBTITLE_HIDE_MS)
            hideSubtitle()
        }
    }

    private fun hideSubtitle() {
        hideJob?.cancel()
        subtitleBox.visibility = View.GONE
        subOriginal.text = ""
        subTranslated.text = ""
        subTranslated.visibility = View.GONE
    }

    private fun applySubtitleScale() {
        val s = prefs.subtitleScale
        subTranslated.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f * s)
        subOriginal.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f * s)
    }

    // ---------------- 조작 ----------------

    private fun updateButtons() {
        btnCc.text = getString(if (prefs.subtitleOn) R.string.btn_cc_on else R.string.btn_cc_off)
        btnChatTr.text =
            getString(if (prefs.chatTranslate) R.string.btn_chat_on else R.string.btn_chat_off)
        btnLang.text = getString(R.string.btn_lang, Languages.shortLabel(prefs.targetLang))
    }

    private fun chooseLanguage() {
        val langs = Languages.targets
        val current = langs.indexOfFirst { it.code == prefs.targetLang }
        AlertDialog.Builder(this)
            .setTitle(R.string.target_language)
            .setSingleChoiceItems(langs.map { it.label }.toTypedArray(), current) { d, which ->
                prefs.targetLang = langs[which].code
                updateButtons()
                if (prefs.chatTranslate) retranslateRecent()
                if (speech != null) onSpeechReady()
                d.dismiss()
            }
            .show()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        applyOrientation(newConfig.orientation == Configuration.ORIENTATION_LANDSCAPE)
    }

    private fun applyOrientation(isLandscape: Boolean) {
        landscape = isLandscape
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        if (isLandscape) {
            root.orientation = LinearLayout.HORIZONTAL
            videoBox.keepRatio = false
            videoBox.layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f)
            val panelWidth = (resources.displayMetrics.widthPixels * 0.32f).toInt()
            sidePanel.layoutParams =
                LinearLayout.LayoutParams(panelWidth, ViewGroup.LayoutParams.MATCH_PARENT)
            header.visibility = View.GONE
            controller.systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            controller.hide(WindowInsetsCompat.Type.systemBars())
            btnRotate.text = getString(R.string.btn_portrait)
        } else {
            root.orientation = LinearLayout.VERTICAL
            videoBox.keepRatio = true
            videoBox.layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
            )
            sidePanel.layoutParams =
                LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
            sidePanel.visibility = View.VISIBLE
            header.visibility = View.VISIBLE
            controller.show(WindowInsetsCompat.Type.systemBars())
            btnRotate.text = getString(R.string.btn_landscape)
        }
    }

    // ---------------- 생명주기 ----------------

    override fun onStart() {
        super.onStart()
        player?.let {
            it.seekToDefaultPosition()
            it.play()
        }
    }

    override fun onStop() {
        super.onStop()
        player?.pause()
    }

    override fun onDestroy() {
        tap.target = null
        speech?.stop()
        speech = null
        chat?.close()
        chat = null
        playerView.player = null
        player?.release()
        player = null
        super.onDestroy()
    }
}
