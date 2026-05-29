package com.tf64.faltkarta.geotiffpreview

import android.graphics.Bitmap
import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.beyka.tiffbitmapfactory.TiffBitmapFactory
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.max
import kotlin.math.roundToInt

class FaltkartaGeoTiffPreviewModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FaltkartaGeoTiffPreview")

    AsyncFunction("generatePreview") { inputUri: String, outputUri: String, maxSide: Int ->
      generatePreview(inputUri, outputUri, maxSide)
    }
  }

  private fun generatePreview(inputUri: String, outputUri: String, maxSide: Int): Map<String, Any> {
    val inputFile = fileFromUri(inputUri)
    val outputFile = fileFromUri(outputUri)
    val boundedMaxSide = maxSide.coerceIn(256, 4096)

    if (!inputFile.exists()) {
      throw IllegalArgumentException("GeoTIFF file does not exist: $inputUri")
    }
    outputFile.parentFile?.mkdirs()

    val boundsOptions = TiffBitmapFactory.Options().apply {
      inJustDecodeBounds = true
      inDirectoryNumber = 0
      inThrowException = true
    }
    TiffBitmapFactory.decodeFile(inputFile, boundsOptions)

    val srcWidth = boundsOptions.outWidth
    val srcHeight = boundsOptions.outHeight
    if (srcWidth <= 0 || srcHeight <= 0) {
      throw IllegalArgumentException("Could not read GeoTIFF dimensions.")
    }

    val decodeOptions = TiffBitmapFactory.Options().apply {
      inDirectoryNumber = 0
      inSampleSize = calculateSampleSize(srcWidth, srcHeight, boundedMaxSide)
      inAvailableMemory = 128L * 1024L * 1024L
      inThrowException = true
    }
    val decoded = TiffBitmapFactory.decodeFile(inputFile, decodeOptions)
      ?: throw IllegalArgumentException("Could not decode GeoTIFF image.")

    val preview = scaleToMaxSide(decoded, boundedMaxSide)
    FileOutputStream(outputFile).use { stream ->
      if (!preview.compress(Bitmap.CompressFormat.PNG, 100, stream)) {
        throw IllegalStateException("Could not write GeoTIFF preview.")
      }
    }

    if (preview !== decoded) {
      preview.recycle()
    }
    decoded.recycle()
    return mapOf(
      "previewUri" to outputUri,
      "ifd" to readGeoTiffIfd(inputFile)
    )
  }

  private fun fileFromUri(uriString: String): File {
    val uri = Uri.parse(uriString)
    return if (uri.scheme == "file") {
      File(uri.path ?: throw IllegalArgumentException("Invalid file URI: $uriString"))
    } else {
      File(uriString)
    }
  }

  private fun calculateSampleSize(width: Int, height: Int, maxSide: Int): Int {
    var sample = 1
    val longest = max(width, height)
    while (longest / (sample * 2) >= maxSide) {
      sample *= 2
    }
    return sample
  }

  private fun scaleToMaxSide(bitmap: Bitmap, maxSide: Int): Bitmap {
    val longest = max(bitmap.width, bitmap.height)
    if (longest <= maxSide) {
      return bitmap
    }
    val scale = maxSide.toDouble() / longest.toDouble()
    val width = max(1, (bitmap.width * scale).roundToInt())
    val height = max(1, (bitmap.height * scale).roundToInt())
    return Bitmap.createScaledBitmap(bitmap, width, height, true)
  }

  private fun readGeoTiffIfd(file: File): Map<String, Any> {
    RandomAccessFile(file, "r").use { raf ->
      if (raf.length() < 8) return emptyMap()

      val byteOrderMark = ByteArray(2)
      raf.readFully(byteOrderMark)
      val order = when (String(byteOrderMark, Charsets.US_ASCII)) {
        "II" -> ByteOrder.LITTLE_ENDIAN
        "MM" -> ByteOrder.BIG_ENDIAN
        else -> return emptyMap()
      }

      if (raf.readUnsignedShort(order) != 42) return emptyMap()
      val ifdOffset = raf.readUnsignedInt(order)
      if (ifdOffset <= 0 || ifdOffset >= raf.length()) return emptyMap()

      raf.seek(ifdOffset)
      val entryCount = raf.readUnsignedShort(order)
      val ifd = mutableMapOf<String, Any>()

      repeat(entryCount) {
        val entryOffset = raf.filePointer
        val tag = raf.readUnsignedShort(order)
        val type = raf.readUnsignedShort(order)
        val count = raf.readUnsignedInt(order)
        val valueOffset = raf.readUnsignedInt(order)
        val value = readTiffValue(raf, order, entryOffset + 8, type, count, valueOffset)

        if (value != null && tag in GEO_TIFF_TAGS) {
          ifd["t$tag"] = value
          if (tag == 256) ifd["width"] = value
          if (tag == 257) ifd["height"] = value
        }
      }

      return ifd
    }
  }

  private fun readTiffValue(
    raf: RandomAccessFile,
    order: ByteOrder,
    inlineOffset: Long,
    type: Int,
    count: Long,
    valueOffset: Long
  ): Any? {
    val typeSize = TIFF_TYPE_SIZES[type] ?: return null
    val byteCount = typeSize * count
    val current = raf.filePointer
    val dataOffset = if (byteCount <= 4) inlineOffset else valueOffset
    if (count > Int.MAX_VALUE || dataOffset < 0 || dataOffset + byteCount > raf.length()) {
      raf.seek(current)
      return null
    }

    raf.seek(dataOffset)
    val value = when (type) {
      2 -> {
        val bytes = ByteArray(byteCount.toInt())
        raf.readFully(bytes)
        String(bytes, Charsets.US_ASCII).trimEnd('\u0000')
      }
      3 -> readNumberList(count) { raf.readUnsignedShort(order).toDouble() }
      4 -> readNumberList(count) { raf.readUnsignedInt(order).toDouble() }
      12 -> readNumberList(count) { raf.readDouble(order) }
      else -> null
    }
    raf.seek(current)
    return value
  }

  private fun readNumberList(count: Long, read: () -> Double): Any {
    val values = List(count.toInt()) { read() }
    return if (values.size == 1) values[0] else values
  }

  private fun RandomAccessFile.readUnsignedShort(order: ByteOrder): Int {
    val bytes = ByteArray(2)
    readFully(bytes)
    return ByteBuffer.wrap(bytes).order(order).short.toInt() and 0xffff
  }

  private fun RandomAccessFile.readUnsignedInt(order: ByteOrder): Long {
    val bytes = ByteArray(4)
    readFully(bytes)
    return ByteBuffer.wrap(bytes).order(order).int.toLong() and 0xffffffffL
  }

  private fun RandomAccessFile.readDouble(order: ByteOrder): Double {
    val bytes = ByteArray(8)
    readFully(bytes)
    return ByteBuffer.wrap(bytes).order(order).double
  }

  companion object {
    private val GEO_TIFF_TAGS = setOf(256, 257, 33550, 33922, 34264, 34735, 34737)
    private val TIFF_TYPE_SIZES = mapOf(
      2 to 1L,
      3 to 2L,
      4 to 4L,
      12 to 8L
    )
  }
}
