package com.seolha.chzzktranslate

import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.ProgressBar
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import com.google.android.material.button.MaterialButton
import com.google.android.material.chip.Chip
import com.google.android.material.chip.ChipGroup
import com.google.android.material.materialswitch.MaterialSwitch
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {

    private lateinit var prefs: Prefs
    private lateinit var models: ModelManager
    private lateinit var inputLayout: TextInputLayout
    private lateinit var input: TextInputEditText
    private lateinit var recentLabel: TextView
    private lateinit var recentGroup: ChipGroup
    private lateinit var targetSpinner: Spinner
    private lateinit var speechSpinner: Spinner
    private lateinit var modelStatus: TextView
    private lateinit var modelButton: MaterialButton
    private lateinit var modelProgress: ProgressBar
    private lateinit var swChat: MaterialSwitch
    private lateinit var swSubtitle: MaterialSwitch
    private lateinit var swOriginal: MaterialSwitch

    private var downloadJob: Job? = null
    private var clipboardChecked = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        prefs = Prefs(this)
        models = ModelManager(this)

        val scroll = findViewById<View>(R.id.scroll)
        ViewCompat.setOnApplyWindowInsetsListener(scroll) { v, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime()
            )
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }

        inputLayout = findViewById(R.id.input_layout)
        input = findViewById(R.id.input_channel)
        recentLabel = findViewById(R.id.recent_label)
        recentGroup = findViewById(R.id.recent_group)
        targetSpinner = findViewById(R.id.spinner_target)
        speechSpinner = findViewById(R.id.spinner_speech)
        modelStatus = findViewById(R.id.model_status)
        modelButton = findViewById(R.id.btn_model)
        modelProgress = findViewById(R.id.model_progress)
        swChat = findViewById(R.id.sw_chat)
        swSubtitle = findViewById(R.id.sw_subtitle)
        swOriginal = findViewById(R.id.sw_original)

        findViewById<MaterialButton>(R.id.btn_watch).setOnClickListener { watch() }
        input.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_GO) {
                watch(); true
            } else false
        }
        inputLayout.setEndIconOnClickListener { pasteFromClipboard(force = true) }

        setupSpinners()
        setupSwitches()
        modelButton.setOnClickListener { onModelButton() }
        refreshModelUi()

        handleIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        refreshRecent()
        refreshModelUi()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        // 안드로이드 10 이상은 창에 포커스가 있을 때만 클립보드를 읽을 수 있다.
        if (hasFocus && !clipboardChecked) {
            clipboardChecked = true
            pasteFromClipboard(force = false)
        }
    }

    private fun handleIntent(intent: Intent?) {
        val text = when (intent?.action) {
            Intent.ACTION_SEND -> intent.getStringExtra(Intent.EXTRA_TEXT)
            Intent.ACTION_VIEW -> intent.dataString
            else -> null
        } ?: return
        val id = ChzzkApi.parseChannelId(text)
        if (id == null) {
            Toast.makeText(this, R.string.invalid_channel, Toast.LENGTH_SHORT).show()
            return
        }
        input.setText(id)
        openPlayer(id)
    }

    private fun pasteFromClipboard(force: Boolean) {
        if (!force && !input.text.isNullOrBlank()) return
        val cm = getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return
        val clip = try {
            cm.primaryClip
        } catch (_: Exception) {
            null
        }
        val text = clip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(this)?.toString()
        val id = ChzzkApi.parseChannelId(text)
        if (id != null) {
            input.setText(id)
            if (!force) Toast.makeText(this, R.string.clipboard_found, Toast.LENGTH_SHORT).show()
        } else if (force) {
            Toast.makeText(this, R.string.clipboard_none, Toast.LENGTH_SHORT).show()
        }
    }

    private fun watch() {
        val id = ChzzkApi.parseChannelId(input.text?.toString())
        if (id == null) {
            inputLayout.error = getString(R.string.invalid_channel)
            return
        }
        inputLayout.error = null
        openPlayer(id)
    }

    private fun openPlayer(id: String) {
        startActivity(
            Intent(this, PlayerActivity::class.java).putExtra(PlayerActivity.EXTRA_CHANNEL_ID, id)
        )
    }

    private fun refreshRecent() {
        recentGroup.removeAllViews()
        val list = prefs.recent
        recentLabel.visibility = if (list.isEmpty()) View.GONE else View.VISIBLE
        recentGroup.visibility = if (list.isEmpty()) View.GONE else View.VISIBLE
        list.forEach { ch ->
            val chip = Chip(this).apply {
                text = ch.name
                isCloseIconVisible = true
                setOnClickListener { openPlayer(ch.id) }
                setOnCloseIconClickListener {
                    prefs.removeRecent(ch.id)
                    refreshRecent()
                }
            }
            recentGroup.addView(chip)
        }
    }

    private fun setupSpinners() {
        val targets = Languages.targets
        targetSpinner.adapter = ArrayAdapter(
            this, R.layout.spinner_item, targets.map { it.label }
        ).apply { setDropDownViewResource(R.layout.spinner_dropdown_item) }
        targetSpinner.setSelection(targets.indexOfFirst { it.code == prefs.targetLang }.coerceAtLeast(0))
        targetSpinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(p: AdapterView<*>?, v: View?, pos: Int, id: Long) {
                prefs.targetLang = targets[pos].code
            }

            override fun onNothingSelected(p: AdapterView<*>?) {}
        }

        val speech = Languages.speech
        speechSpinner.adapter = ArrayAdapter(
            this, R.layout.spinner_item, speech.map { it.label }
        ).apply { setDropDownViewResource(R.layout.spinner_dropdown_item) }
        speechSpinner.setSelection(speech.indexOfFirst { it.code == prefs.speechLang }.coerceAtLeast(0))
        speechSpinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(p: AdapterView<*>?, v: View?, pos: Int, id: Long) {
                prefs.speechLang = speech[pos].code
                refreshModelUi()
            }

            override fun onNothingSelected(p: AdapterView<*>?) {}
        }
    }

    private fun setupSwitches() {
        swChat.isChecked = prefs.chatTranslate
        swSubtitle.isChecked = prefs.subtitleOn
        swOriginal.isChecked = prefs.showOriginal
        swChat.setOnCheckedChangeListener { _, checked -> prefs.chatTranslate = checked }
        swSubtitle.setOnCheckedChangeListener { _, checked -> prefs.subtitleOn = checked }
        swOriginal.setOnCheckedChangeListener { _, checked -> prefs.showOriginal = checked }
    }

    private fun refreshModelUi() {
        if (downloadJob != null) return
        val model = Languages.speechModel(prefs.speechLang)
        modelProgress.visibility = View.GONE
        modelButton.isEnabled = true
        if (models.isReady(model.code)) {
            modelStatus.text = getString(R.string.model_ready, model.label)
            modelButton.text = getString(R.string.model_delete)
        } else {
            modelStatus.text = getString(R.string.model_missing, model.label, model.sizeMb)
            modelButton.text = getString(R.string.model_download)
        }
    }

    private fun onModelButton() {
        val model = Languages.speechModel(prefs.speechLang)
        if (models.isReady(model.code)) {
            models.delete(model.code)
            refreshModelUi()
            return
        }
        modelButton.isEnabled = false
        speechSpinner.isEnabled = false
        modelProgress.visibility = View.VISIBLE
        modelProgress.progress = 0
        modelStatus.text = getString(R.string.model_downloading, 0)
        downloadJob = lifecycleScope.launch {
            try {
                models.download(model) { p ->
                    modelProgress.progress = p
                    modelStatus.text = if (p < 92) getString(R.string.model_downloading, p)
                    else getString(R.string.model_unzipping)
                }
                Toast.makeText(this@MainActivity, R.string.model_done, Toast.LENGTH_SHORT).show()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Toast.makeText(
                    this@MainActivity,
                    getString(R.string.model_failed, e.message ?: ""),
                    Toast.LENGTH_LONG
                ).show()
            } finally {
                downloadJob = null
                speechSpinner.isEnabled = true
                refreshModelUi()
            }
        }
    }
}
