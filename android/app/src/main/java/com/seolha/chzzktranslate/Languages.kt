package com.seolha.chzzktranslate

data class Lang(val code: String, val label: String)

data class SpeechModel(val code: String, val label: String, val url: String, val sizeMb: Int)

object Languages {
    val targets = listOf(
        Lang("en", "English"),
        Lang("ko", "한국어"),
        Lang("ja", "日本語"),
        Lang("zh-CN", "中文 (简体)"),
        Lang("zh-TW", "中文 (繁體)"),
        Lang("es", "Español"),
        Lang("fr", "Français"),
        Lang("de", "Deutsch"),
        Lang("it", "Italiano"),
        Lang("pt", "Português"),
        Lang("ru", "Русский"),
        Lang("vi", "Tiếng Việt"),
        Lang("th", "ไทย"),
        Lang("id", "Bahasa Indonesia"),
        Lang("tr", "Türkçe"),
        Lang("ar", "العربية"),
        Lang("hi", "हिन्दी")
    )

    private const val VOSK = "https://alphacephei.com/vosk/models/"

    /** 방송 음성 인식용 오프라인 모델 (Vosk small) */
    val speech = listOf(
        SpeechModel("ko", "한국어", VOSK + "vosk-model-small-ko-0.22.zip", 83),
        SpeechModel("en", "English", VOSK + "vosk-model-small-en-us-0.15.zip", 40),
        SpeechModel("ja", "日本語", VOSK + "vosk-model-small-ja-0.22.zip", 48),
        SpeechModel("zh-CN", "中文", VOSK + "vosk-model-small-cn-0.22.zip", 42)
    )

    fun target(code: String): Lang = targets.firstOrNull { it.code == code } ?: targets[0]

    fun speechModel(code: String): SpeechModel = speech.firstOrNull { it.code == code } ?: speech[0]

    fun shortLabel(code: String): String = code.uppercase().replace("ZH-", "ZH ")
}
