package com.seolha.chzzktranslate

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

data class RecentChannel(val id: String, val name: String)

class Prefs(context: Context) {
    private val sp: SharedPreferences =
        context.applicationContext.getSharedPreferences("settings", Context.MODE_PRIVATE)

    var targetLang: String
        get() = sp.getString("targetLang", "en") ?: "en"
        set(v) = sp.edit().putString("targetLang", v).apply()

    var speechLang: String
        get() = sp.getString("speechLang", "ko") ?: "ko"
        set(v) = sp.edit().putString("speechLang", v).apply()

    var chatTranslate: Boolean
        get() = sp.getBoolean("chatTranslate", true)
        set(v) = sp.edit().putBoolean("chatTranslate", v).apply()

    var subtitleOn: Boolean
        get() = sp.getBoolean("subtitleOn", true)
        set(v) = sp.edit().putBoolean("subtitleOn", v).apply()

    var showOriginal: Boolean
        get() = sp.getBoolean("showOriginal", true)
        set(v) = sp.edit().putBoolean("showOriginal", v).apply()

    var subtitleScale: Float
        get() = sp.getFloat("subtitleScale", 1f)
        set(v) = sp.edit().putFloat("subtitleScale", v).apply()

    val recent: List<RecentChannel>
        get() {
            val raw = sp.getString("recent", null) ?: return emptyList()
            return try {
                val arr = JSONArray(raw)
                (0 until arr.length()).mapNotNull { i ->
                    val o = arr.optJSONObject(i) ?: return@mapNotNull null
                    val id = o.optString("id")
                    if (id.isBlank()) null else RecentChannel(id, o.optString("name", id))
                }
            } catch (e: Exception) {
                emptyList()
            }
        }

    fun addRecent(id: String, name: String) {
        val list = recent.filter { it.id != id }.toMutableList()
        list.add(0, RecentChannel(id, name.ifBlank { id.take(8) }))
        val arr = JSONArray()
        list.take(8).forEach { arr.put(JSONObject().put("id", it.id).put("name", it.name)) }
        sp.edit().putString("recent", arr.toString()).apply()
    }

    fun removeRecent(id: String) {
        val arr = JSONArray()
        recent.filter { it.id != id }
            .forEach { arr.put(JSONObject().put("id", it.id).put("name", it.name)) }
        sp.edit().putString("recent", arr.toString()).apply()
    }
}
