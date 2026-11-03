package com.seolha.chzzktranslate

import android.content.Context
import android.util.AttributeSet
import android.widget.FrameLayout

/** 세로 화면에서 영상 영역을 16:9로 유지하는 FrameLayout */
class RatioFrameLayout @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : FrameLayout(context, attrs) {

    var keepRatio: Boolean = true
        set(value) {
            field = value
            requestLayout()
        }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        if (keepRatio) {
            val width = MeasureSpec.getSize(widthMeasureSpec)
            val height = width * 9 / 16
            super.onMeasure(
                MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY),
                MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY)
            )
        } else {
            super.onMeasure(widthMeasureSpec, heightMeasureSpec)
        }
    }
}
