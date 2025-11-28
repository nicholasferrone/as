import JSZip from 'jszip';
import { Story } from '../types';

/**
 * Clean base64 string for JSZip (remove data URI prefix)
 */
const cleanBase64 = (dataUrl: string) => {
  return dataUrl.split(',')[1];
};

/**
 * Identify mime type from base64 header
 */
const getMimeType = (dataUrl: string) => {
  const match = dataUrl.match(/^data:(.+);base64,/);
  return match ? match[1] : 'image/jpeg';
};

/**
 * Get file extension from mime type
 */
const getExtension = (mime: string) => {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
};

/**
 * Generates a valid EPUB 3.0 file from the Story object
 */
export const generateEpub = async (story: Story): Promise<Blob> => {
  const zip = new JSZip();

  // 1. Mimetype (Must be first, uncompressed)
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });

  // 2. Container XML
  zip.folder("META-INF")?.file("container.xml", `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
   <rootfiles>
      <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
   </rootfiles>
</container>`);

  const oebps = zip.folder("OEBPS");
  if (!oebps) throw new Error("Failed to create OEBPS folder");

  // 3. Assets Preparation
  const images: { id: string, href: string, mediaType: string, data: string }[] = [];
  const pages: { id: string, href: string, title: string, content: string }[] = [];

  // Add Cover Image
  if (story.coverImageData) {
    const mime = getMimeType(story.coverImageData);
    const ext = getExtension(mime);
    const filename = `images/cover.${ext}`;
    
    oebps.file(filename, cleanBase64(story.coverImageData), { base64: true });
    images.push({ id: "cover-image", href: filename, mediaType: mime, data: story.coverImageData });
  }

  // Add Story Pages Images
  story.pages.forEach((page, index) => {
    if (page.imageData) {
      const mime = getMimeType(page.imageData);
      const ext = getExtension(mime);
      const filename = `images/page-${index}.${ext}`;
      
      oebps.file(filename, cleanBase64(page.imageData), { base64: true });
      images.push({ id: `img-${index}`, href: filename, mediaType: mime, data: page.imageData });
    }
  });

  // 4. Create CSS
  const css = `
    body { font-family: 'Times New Roman', serif; margin: 0; padding: 0; text-align: center; }
    .page-container { page-break-after: always; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; }
    img { max-width: 100%; max-height: 70vh; object-fit: contain; margin-bottom: 2em; }
    p { font-size: 1.5em; line-height: 1.6; padding: 0 1em; }
    h1 { font-size: 3em; color: #333; }
    .cover-title { margin-top: 1em; }
    .subtitle { font-style: italic; color: #666; margin-bottom: 2em; }
  `;
  oebps.file("styles.css", css);

  // 5. Create XHTML Pages

  // Cover Page HTML
  const coverContent = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>${story.title}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <div class="page-container">
    ${images.find(i => i.id === 'cover-image') ? `<img src="${images.find(i => i.id === 'cover-image')?.href}" alt="Cover" />` : ''}
    <h1 class="cover-title">${story.title}</h1>
    <p class="subtitle">${story.subtitle}</p>
    <p>An AI Generated Tale</p>
  </div>
</body>
</html>`;
  oebps.file("cover.xhtml", coverContent);
  pages.push({ id: "cover", href: "cover.xhtml", title: "Cover", content: coverContent });

  // Story Pages HTML
  story.pages.forEach((page, index) => {
    const imgRef = images.find(i => i.id === `img-${index}`);
    const pageContent = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>${story.title} - Page ${index + 1}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <div class="page-container">
    ${imgRef ? `<img src="${imgRef.href}" alt="Illustration" />` : ''}
    <p>${page.text}</p>
  </div>
</body>
</html>`;
    oebps.file(`page-${index}.xhtml`, pageContent);
    pages.push({ id: `page-${index}`, href: `page-${index}.xhtml`, title: `Page ${index + 1}`, content: pageContent });
  });

  // 6. Create OPF (Package Document)
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uuid_id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${story.title}</dc:title>
    <dc:description>${story.subtitle}</dc:description>
    <dc:creator>DreamWeaver AI</dc:creator>
    <dc:identifier id="uuid_id">urn:uuid:${Date.now()}</dc:identifier>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().split('.')[0]}Z</meta>
  </metadata>
  <manifest>
    <item id="css" href="styles.css" media-type="text/css"/>
    ${images.map(img => `<item id="${img.id}" href="${img.href}" media-type="${img.mediaType}" />`).join('\n    ')}
    ${pages.map(p => `<item id="${p.id}" href="${p.href}" media-type="application/xhtml+xml" />`).join('\n    ')}
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="ncx">
    ${pages.map(p => `<itemref idref="${p.id}" />`).join('\n    ')}
  </spine>
</package>`;
  oebps.file("content.opf", opf);

  // 7. Create NCX (Table of Contents - Legacy but good for compatibility)
  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${Date.now()}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${story.title}</text></docTitle>
  <navMap>
    ${pages.map((p, i) => `
    <navPoint id="navPoint-${i}" playOrder="${i + 1}">
      <navLabel><text>${p.title}</text></navLabel>
      <content src="${p.href}"/>
    </navPoint>`).join('')}
  </navMap>
</ncx>`;
  oebps.file("toc.ncx", ncx);

  return await zip.generateAsync({ type: "blob" });
};