<div align="center">
  <a href="https://github.com/hhk-png/lingo-reader">Home Page</a>&nbsp;&nbsp;&nbsp;
  <a href="./README-zh.md">中文</a>
</div>

The parsing of MOBI and KF8 files is based on [this MOBI parsing implementation.](https://github.com/johnfactotum/foliate-js/blob/main/mobi.js)

# Introduction

The MOBI file format is based on the PDB file format, while the KF8 (Kindle Format 8) format is built on top of MOBI. Therefore, the parsing of both MOBI and KF8 is handled together in the `mobi-parser`.

# Install

```shell
pnpm install @lingo-reader/mobi-parser
```

# MobiFile

## Usage in browser

```typescript
import { initMobiFile } from '@lingo-reader/mobi-parser'
import type { MobiSpine } from '@lingo-reader/mobi-parser'

function initMobi(file: File) {
  const mobi: Mobi = await initMobiFile(file)
  // spine
  const spine: MobiSpine = mobi.getSpine()
  // loadChapter
  const firstChapter = mobi.loadChapter(spine[0].id)
}

// see Mobi class
// .....
```

## Usage in node

```typescript
import { initMobiFile } from '@lingo-reader/mobi-parser'
import type { MobiSpine } from '@lingo-reader/mobi-parser'

const mobi: Mobi = await initMobiFile('./example/taoyong.mobi')
// spine
const spine: MobiSpine = mobi.getSpine()
// loadChapter
const firstChapter = mobi.loadChapter(spine[0].id)

// see Mobi class
// .....
```

## initMobiFile(file: string | File |Uint8Array, resourceSaveDir?: string): Promise\<Mobi\>

API for initializing a MOBI file. You can pass in a file path, a `File` object, or a `Uint8Array` to receive a `Mobi` instance, which provides APIs for reading metadata, spine information, and more.

**Parameters:**

- `file: string | File | Uint8Array` – The MOBI file input, which can be a file path (Node.js), a `File` object (browser), or a `Uint8Array` in either environment.
- `resourceSaveDir?: string` – *(Optional)* Applicable mainly in Node.js. Specifies the directory to save images and other resources. Defaults to `./images`.

**Returns:**

- `Promise` – A Promise that resolves to the initialized `Mobi` object.

**Note:**
For the `file` parameter:

- In the **browser**, it must be a `File` or `Uint8Array`. Passing a `string` will throw an error.
- In **Node.js**, it must be a `string` or `Uint8Array`. Passing a `File` will throw an error.

## Mobi class

```typescript
class Mobi {
  getFileInfo(): MobiFileInfo
  getSpine(): MobiSpine
  loadChapter(id: string): MobiProcessedChapter | undefined
  getToc(): MobiToc
  getCoverImage(): string
  getMetadata(): MobiMetadata
  resolveHref(href: string): MobiResolvedHref | undefined
  destroy(): void
}
```

### getFileInfo(): MobiFileInfo

```typescript
interface MobiFileInfo {
  // MOBI file name, including the file extension
  fileName: string
}
```

This returns file information, currently with only the `fileName` field.

### getSpine(): MobiSpine

```typescript
interface MobiChapter {
  // Chapter ID
  id: string
  // Raw HTML text with unmodified resource paths
  text: string
  // The byte position where the chapter starts in the file
  start: number
  // The byte position where the chapter ends in the file
  end: number
  // The byte size of the chapter
  size: number
}
type MobiSpine = MobiChapter[]
```

The spine lists all the chapters to be displayed in sequence.

In the original HTML text of the chapters, image resource paths point to internal file addresses. These need to be replaced with blob URLs in order to display them directly in the browser.

### loadChapter(id: string): MobiProcessedChapter | undefined

```typescript
interface MobiCssPart {
  id: string
  href: string
}
interface MobiProcessedChapter {
  html: string
  css: MobiCssPart[]
}
```

The `loadChapter` function takes a chapter ID as its argument and returns the processed chapter object. If the return value is `undefined`, it means the chapter does not exist.

The raw HTML is split into CSS and text (`MobiProcessedChapter`), where the CSS is provided as a blob URL (`MobiCssPart`), and the HTML is the modified text after resource replacement, mainly in the `<body>` tag content.

### getToc(): MobiToc

```typescript
interface MobiTocItem {
  // TOC item label
  label: string
  // Internal MOBI href
  href: string
  // Sub TOC item
  children?: MobiTocItem[]
}
type MobiToc = MobiTocItem[]
```

This function retrieves the table of contents (TOC) of the book.

### getCoverImage(): string

This retrieves the cover image of the book as a blob URL. When an empty string is returned, it means that the `CoverImage` does not exist.

### getMetadata(): MobiMetadata

```typescript
interface MobiMetadata {
  // Unique identifier
  identifier: string
  // Book title
  title: string
  // Author(s)
  author: string[]
  // Publisher
  publisher: string
  // Language of the book
  language: string
  // Publication date
  published: string
  // Description of the book
  description: string
  // Categories or subjects
  subject: string[]
  // Copyright information
  rights: string
  // Contributors
  contributor: string[]
}
```

This retrieves the metadata for the book.

### resolveHref(href: string): MobiResolvedHref | undefined

```typescript
interface MobiResolvedHref {
  // Chapter ID
  id: string
  // HTML selector
  selector: string
}
```

This function parses links that point to other chapters and returns the result in the format shown above.

### destroy(): void

This function clears blob URLs and resources created during the file parsing process to prevent memory leaks.

# Kf8File

## Usage in browser

```typescript
import { initKf8File } from '@lingo-reader/mobi-parser'
import type { Kf8Spine } from '@lingo-reader/mobi-parser'

function initMobi(file: File) {
  const mobi: Kf8 = await initKf8File(file)
  // spine
  const spine: Kf8Spine = mobi.getSpine()
  // loadChapter
  const firstChapter: Kf8ProcessedChapter = mobi.loadChapter(spine[0].id)
}

// see Kf8 class
// .....
```

## Usage in node

```typescript
import { initKf8File } from '@lingo-reader/mobi-parser'
import type { Kf8Spine } from '@lingo-reader/mobi-parser'

const mobi: Kf8 = await initKf8File('./example/taoyong.azw3')
// spine
const spine: Kf8Spine = mobi.getSpine()
// loadChapter
const firstChapter: Kf8ProcessedChapter = mobi.loadChapter(spine[0].id)

// see Kf8 class
// .....
```

## initKf8File(file: InputFile, resourceSaveDir?: string): Promise\<Kf8\>

API for initializing an AZW3 (KF8) file. You can pass in a file path, a `File` object, or a `Uint8Array` to receive a fully initialized `Kf8` object, which provides APIs for reading metadata, spine information, and more.

**Parameters:**

- `file: string | File | Uint8Array` – The input KF8 file. Can be a file path (Node.js), a `File` object (browser), or a `Uint8Array` in either environment.
- `resourceSaveDir?: string` – *(Optional)* Mainly used in Node.js. Specifies the directory to save images and other resources. Defaults to `./images`.

**Returns:**

- `Promise` – A Promise that resolves to the initialized `Kf8` object.

**Note:**
For the `file` parameter:

- In the **browser**, the type must be `File` or `Uint8Array`. Passing a `string` will throw an error.
- In **Node.js**, the type must be `string` or `Uint8Array`. Passing a `File` will throw an error.

## Kf8 class

```typescript
class Kf8 {
  getFileInfo(): Kf8FileInfo
  getMetadata(): Kf8Metadata
  getCoverImage(): string
  getSpine(): Kf8Spine
  getToc(): Kf8Toc
  getGuide(): Kf8Guide | undefined
  loadChapter(id: string): Kf8ProcessedChapter | undefined
  resolveHref(href: string): Kf8ResolvedHref | undefined
  destroy(): void
}
```

### getFileInfo(): Kf8FileInfo

```typescript
type Kf8FileInfo = MobiFileInfo
```

This is the same as `MobiFileInfo`, [see here](#getfileinfo-mobifileinfo)

### getMetadata(): Kf8Metadata

```typescript
type Kf8Metadata = MobiMetadata
```

This is the same as `MobiMetadata`, [see here](#getmetadata-mobimetadata)

### getCoverImage(): string

This retrieves the book's cover image as a blob URL. When an empty string is returned, it means that the `CoverImage` does not exist.

### getSpine(): Kf8Spine

```typescript
interface Kf8Chapter {
  id: string
  skel: SkelTableItem
  frags: FragTable
  fragEnd: number
  length: number
  totalLength: number
}
type Kf8Spine = Kf8Chapter[]
```

No explanation available yet.

### getToc(): Kf8Toc

```typescript
interface Kf8TocItem {
  label: string
  // Path to the chapter resource
  href: string
  children?: Kf8TocItem[]
}
type Kf8Toc = Kf8TocItem[]
```

This retrieves the table of contents (TOC).

### getGuide(): Kf8Guide | undefined

```typescript
interface Kf8GuideItem {
  label: string
  type: string[]
  href: string
}
type Kf8Guide = Kf8GuideItem[]
```

This retrieves parts of the book that are available for browsing.

### loadChapter(id: string): Kf8ProcessedChapter | undefined

```typescript
interface Kf8CssPart {
  id: string
  href: string
}
interface Kf8ProcessedChapter {
  html: string
  css: Kf8CssPart[]
}
```

This works similarly to `MobiProcessedChapter`, [see here](#loadchapterid-string-mobiprocessedchapter--undefined)

### resolveHref(href: string): Kf8ResolvedHref | undefined

```typescript
type Kf8ResolvedHref = MobiResolvedHref
```

This works similarly to `MobiResolvedHref`, [see here](#resolvehrefhref-string-mobiresolvedhref--undefined)。

### destroy(): void

Clears the blob URLs and resources created during the parsing process to prevent memory leaks.
