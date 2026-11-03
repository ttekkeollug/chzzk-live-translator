package com.seolha.chzzktranslate

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.zip.ZipInputStream

/** Vosk 오프라인 음성 인식 모델을 내려받고 관리한다. */
class ModelManager(context: Context) {
    private val appContext = context.applicationContext

    private fun dir(code: String) = File(appContext.filesDir, "vosk/$code")

    fun isReady(code: String): Boolean =
        File(dir(code), ".ready").exists() && modelPath(code) != null

    fun modelPath(code: String): String? {
        val d = dir(code)
        if (!d.isDirectory) return null
        return findRoot(d, 0)?.absolutePath
    }

    private fun findRoot(d: File, depth: Int): File? {
        if (File(d, "am").isDirectory || File(d, "conf").isDirectory) return d
        if (depth > 3) return null
        d.listFiles()?.filter { it.isDirectory }?.forEach { child ->
            findRoot(child, depth + 1)?.let { return it }
        }
        return null
    }

    fun delete(code: String) {
        dir(code).deleteRecursively()
    }

    /** @param onProgress 0..100, 메인 스레드에서 호출된다. */
    suspend fun download(model: SpeechModel, onProgress: (Int) -> Unit) {
        withContext(Dispatchers.IO) {
            val target = dir(model.code)
            target.deleteRecursively()
            target.mkdirs()
            val zip = File(appContext.cacheDir, "vosk-${model.code}.zip")
            try {
                val request = Request.Builder().url(model.url).build()
                Http.client.newCall(request).execute().use { res ->
                    if (!res.isSuccessful) throw IOException("다운로드 실패 (HTTP ${res.code})")
                    val body = res.body ?: throw IOException("빈 응답")
                    val total = body.contentLength()
                    body.byteStream().use { input ->
                        FileOutputStream(zip).use { out ->
                            val buf = ByteArray(64 * 1024)
                            var done = 0L
                            var last = -1
                            while (true) {
                                ensureActive()
                                val n = input.read(buf)
                                if (n < 0) break
                                out.write(buf, 0, n)
                                done += n
                                if (total > 0) {
                                    val p = (done * 90 / total).toInt()
                                    if (p != last) {
                                        last = p
                                        withContext(Dispatchers.Main) { onProgress(p) }
                                    }
                                }
                            }
                        }
                    }
                }

                withContext(Dispatchers.Main) { onProgress(92) }
                unzip(zip, target)
                if (findRoot(target, 0) == null) throw IOException("모델 파일 구조가 올바르지 않습니다")
                File(target, ".ready").writeText("ok")
                withContext(Dispatchers.Main) { onProgress(100) }
            } catch (e: Throwable) {
                target.deleteRecursively()
                throw e
            } finally {
                zip.delete()
            }
        }
    }

    private fun unzip(zip: File, target: File) {
        val base = target.canonicalPath + File.separator
        ZipInputStream(zip.inputStream().buffered()).use { zis ->
            while (true) {
                val entry = zis.nextEntry ?: break
                val out = File(target, entry.name)
                if (!out.canonicalPath.startsWith(base)) throw IOException("잘못된 압축 항목")
                if (entry.isDirectory) {
                    out.mkdirs()
                } else {
                    out.parentFile?.mkdirs()
                    FileOutputStream(out).use { zis.copyTo(it) }
                }
                zis.closeEntry()
            }
        }
    }
}
