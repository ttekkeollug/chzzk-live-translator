package com.seolha.chzzktranslate

import android.graphics.Typeface
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.text.style.StyleSpan
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import java.text.NumberFormat
import java.util.Locale

class ChatAdapter : RecyclerView.Adapter<ChatAdapter.Holder>() {

    class Holder(view: View) : RecyclerView.ViewHolder(view) {
        val line: TextView = view.findViewById(R.id.chat_line)
        val translation: TextView = view.findViewById(R.id.chat_translation)
    }

    private companion object {
        const val MAX_ITEMS = 300
        val NICK_COLORS = intArrayOf(
            0xFF00FFA3.toInt(), 0xFF6CC4FF.toInt(), 0xFFFFB86C.toInt(), 0xFFFF79C6.toInt(),
            0xFFBD93F9.toInt(), 0xFFF1FA8C.toInt(), 0xFF8BE9FD.toInt(), 0xFFFF6E6E.toInt()
        )
        val WON: NumberFormat = NumberFormat.getIntegerInstance(Locale.KOREA)
    }

    private val items = ArrayList<ChatMessage>()

    init {
        setHasStableIds(true)
    }

    override fun getItemId(position: Int): Long = items[position].id

    override fun getItemCount(): Int = items.size

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder =
        Holder(LayoutInflater.from(parent.context).inflate(R.layout.item_chat, parent, false))

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val m = items[position]
        val sb = SpannableStringBuilder()
        if (m.donation) sb.append("💰 ")
        val start = sb.length
        sb.append(m.nick)
        val color = if (m.donation) 0xFFFFC94D.toInt()
        else NICK_COLORS[(m.nick.hashCode() and 0x7fffffff) % NICK_COLORS.size]
        sb.setSpan(ForegroundColorSpan(color), start, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        sb.setSpan(StyleSpan(Typeface.BOLD), start, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        if (m.donation && m.amount > 0) sb.append(" · ${WON.format(m.amount)}원")
        sb.append("  ")
        sb.append(m.text)
        holder.line.text = sb

        val tr = m.translation
        if (tr.isNullOrBlank()) {
            holder.translation.visibility = View.GONE
        } else {
            holder.translation.visibility = View.VISIBLE
            holder.translation.text = tr
        }
        holder.itemView.setBackgroundResource(if (m.donation) R.drawable.bg_donation else 0)
    }

    fun add(messages: List<ChatMessage>) {
        if (messages.isEmpty()) return
        val from = items.size
        items.addAll(messages)
        notifyItemRangeInserted(from, messages.size)
        val over = items.size - MAX_ITEMS
        if (over > 0) {
            items.subList(0, over).clear()
            notifyItemRangeRemoved(0, over)
        }
    }

    fun refresh(message: ChatMessage) {
        val index = items.binarySearch { it.id.compareTo(message.id) }
        if (index >= 0) notifyItemChanged(index)
    }

    fun clearTranslations() {
        items.forEach { it.translation = null }
        notifyItemRangeChanged(0, items.size)
    }

    fun recent(count: Int): List<ChatMessage> = items.takeLast(count)
}
