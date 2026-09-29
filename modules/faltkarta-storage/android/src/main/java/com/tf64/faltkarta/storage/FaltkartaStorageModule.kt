package com.tf64.faltkarta.storage

import android.database.sqlite.SQLiteDatabase
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class FaltkartaStorageModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FaltkartaStorage")

    AsyncFunction("getUsedDatabaseBytes") {
      val context = appContext.reactContext ?: error("Android context unavailable")
      val path = context.getDatabasePath("RKStorage")
      if (!path.exists()) return@AsyncFunction 0.0
      SQLiteDatabase.openDatabase(path.absolutePath, null, SQLiteDatabase.OPEN_READONLY).use { db ->
        fun pragma(name: String): Long = db.rawQuery("PRAGMA $name", null).use { cursor ->
          check(cursor.moveToFirst())
          cursor.getLong(0)
        }
        // Free pages can be reused even when the physical file does not shrink.
        val pages = pragma("page_count")
        val freePages = pragma("freelist_count")
        ((pages - freePages).coerceAtLeast(0) * pragma("page_size")).toDouble()
      }
    }
  }
}
