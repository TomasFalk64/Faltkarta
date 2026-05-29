import ExpoModulesCore
import Foundation
import ImageIO
import MobileCoreServices
import UIKit

public class FaltkartaGeoTiffPreviewModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FaltkartaGeoTiffPreview")

    AsyncFunction("generatePreview") { (inputUri: String, outputUri: String, maxSide: Int) -> [String: Any] in
      try generatePreview(inputUri: inputUri, outputUri: outputUri, maxSide: maxSide)
    }
  }

  private func generatePreview(inputUri: String, outputUri: String, maxSide: Int) throws -> [String: Any] {
    let inputUrl = try fileUrl(from: inputUri)
    let outputUrl = try fileUrl(from: outputUri)
    let boundedMaxSide = max(256, min(maxSide, 4096))

    guard let source = CGImageSourceCreateWithURL(inputUrl as CFURL, nil) else {
      throw NSError(domain: "FaltkartaGeoTiffPreview", code: 1, userInfo: [
        NSLocalizedDescriptionKey: "Could not open GeoTIFF file."
      ])
    }

    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: boundedMaxSide
    ]

    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
      throw NSError(domain: "FaltkartaGeoTiffPreview", code: 2, userInfo: [
        NSLocalizedDescriptionKey: "Could not decode GeoTIFF preview."
      ])
    }

    try FileManager.default.createDirectory(
      at: outputUrl.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )

    guard let destination = CGImageDestinationCreateWithURL(outputUrl as CFURL, kUTTypePNG, 1, nil) else {
      throw NSError(domain: "FaltkartaGeoTiffPreview", code: 3, userInfo: [
        NSLocalizedDescriptionKey: "Could not create preview file."
      ])
    }

    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else {
      throw NSError(domain: "FaltkartaGeoTiffPreview", code: 4, userInfo: [
        NSLocalizedDescriptionKey: "Could not write preview file."
      ])
    }

    return [
      "previewUri": outputUri,
      "ifd": readGeoTiffIfd(from: inputUrl)
    ]
  }

  private func fileUrl(from value: String) throws -> URL {
    if let url = URL(string: value), url.isFileURL {
      return url
    }
    return URL(fileURLWithPath: value)
  }

  private func readGeoTiffIfd(from url: URL) -> [String: Any] {
    guard let data = try? Data(contentsOf: url), data.count >= 8 else {
      return [:]
    }

    let littleEndian: Bool
    if data[0] == 0x49 && data[1] == 0x49 {
      littleEndian = true
    } else if data[0] == 0x4d && data[1] == 0x4d {
      littleEndian = false
    } else {
      return [:]
    }

    guard readUInt16(data, at: 2, littleEndian: littleEndian) == 42 else {
      return [:]
    }

    let ifdOffset = Int(readUInt32(data, at: 4, littleEndian: littleEndian))
    guard ifdOffset > 0, ifdOffset + 2 <= data.count else {
      return [:]
    }

    let entryCount = Int(readUInt16(data, at: ifdOffset, littleEndian: littleEndian))
    var ifd: [String: Any] = [:]

    for index in 0..<entryCount {
      let entryOffset = ifdOffset + 2 + index * 12
      guard entryOffset + 12 <= data.count else {
        break
      }

      let tag = Int(readUInt16(data, at: entryOffset, littleEndian: littleEndian))
      guard Self.geoTiffTags.contains(tag) else {
        continue
      }

      let type = Int(readUInt16(data, at: entryOffset + 2, littleEndian: littleEndian))
      let count = Int(readUInt32(data, at: entryOffset + 4, littleEndian: littleEndian))
      let valueOffset = Int(readUInt32(data, at: entryOffset + 8, littleEndian: littleEndian))

      guard let value = readTiffValue(
        data,
        type: type,
        count: count,
        inlineOffset: entryOffset + 8,
        valueOffset: valueOffset,
        littleEndian: littleEndian
      ) else {
        continue
      }

      ifd["t\(tag)"] = value
      if tag == 256 {
        ifd["width"] = value
      }
      if tag == 257 {
        ifd["height"] = value
      }
    }

    return ifd
  }

  private func readTiffValue(
    _ data: Data,
    type: Int,
    count: Int,
    inlineOffset: Int,
    valueOffset: Int,
    littleEndian: Bool
  ) -> Any? {
    guard let typeSize = Self.tiffTypeSizes[type], count >= 0 else {
      return nil
    }
    let byteCount = typeSize * count
    let dataOffset = byteCount <= 4 ? inlineOffset : valueOffset
    guard dataOffset >= 0, dataOffset + byteCount <= data.count else {
      return nil
    }

    switch type {
    case 2:
      let bytes = data[dataOffset..<(dataOffset + byteCount)]
      return String(bytes: bytes.prefix { $0 != 0 }, encoding: .ascii) ?? ""
    case 3:
      let values = (0..<count).map { readUInt16(data, at: dataOffset + $0 * 2, littleEndian: littleEndian) }
      return values.count == 1 ? Int(values[0]) : values.map(Int.init)
    case 4:
      let values = (0..<count).map { readUInt32(data, at: dataOffset + $0 * 4, littleEndian: littleEndian) }
      return values.count == 1 ? Int(values[0]) : values.map { Int($0) }
    case 12:
      let values = (0..<count).map { readDouble(data, at: dataOffset + $0 * 8, littleEndian: littleEndian) }
      return values.count == 1 ? values[0] : values
    default:
      return nil
    }
  }

  private func readUInt16(_ data: Data, at offset: Int, littleEndian: Bool) -> UInt16 {
    guard offset + 2 <= data.count else {
      return 0
    }
    let value = UInt16(data[offset]) | (UInt16(data[offset + 1]) << 8)
    return littleEndian ? value : value.byteSwapped
  }

  private func readUInt32(_ data: Data, at offset: Int, littleEndian: Bool) -> UInt32 {
    guard offset + 4 <= data.count else {
      return 0
    }
    let value =
      UInt32(data[offset]) |
      (UInt32(data[offset + 1]) << 8) |
      (UInt32(data[offset + 2]) << 16) |
      (UInt32(data[offset + 3]) << 24)
    return littleEndian ? value : value.byteSwapped
  }

  private func readDouble(_ data: Data, at offset: Int, littleEndian: Bool) -> Double {
    guard offset + 8 <= data.count else {
      return 0
    }
    var bits: UInt64 = 0
    for index in 0..<8 {
      bits |= UInt64(data[offset + index]) << UInt64(index * 8)
    }
    if !littleEndian {
      bits = bits.byteSwapped
    }
    return Double(bitPattern: bits)
  }

  private static let geoTiffTags: Set<Int> = [256, 257, 33550, 33922, 34264, 34735, 34737]
  private static let tiffTypeSizes: [Int: Int] = [
    2: 1,
    3: 2,
    4: 4,
    12: 8
  ]
}
