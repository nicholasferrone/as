
import { Story } from '../types';
import JSZip from 'jszip';

/**
 * Utility: Convert an AudioBuffer to a Blob (WAV format) and then to Base64 string
 * This is necessary because we can't embed raw AudioBuffers in HTML.
 */
export const audioBufferToWav = (buffer: AudioBuffer): string => {
  const numChannels = 1; // Gemini TTS is usually mono
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  
  const data = buffer.getChannelData(0);
  const dataSize = data.length * bytesPerSample;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;
  
  const arrayBuffer = new ArrayBuffer(totalSize);
  const view = new DataView(arrayBuffer);
  
  const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  let offset = 0;
  
  // RIFF chunk descriptor
  writeString(view, offset, 'RIFF'); offset += 4;
  view.setUint32(offset, totalSize - 8, true); offset += 4;
  writeString(view, offset, 'WAVE'); offset += 4;
  
  // FMT sub-chunk
  writeString(view, offset, 'fmt '); offset += 4;
  view.setUint32(offset, 16, true); offset += 4; // Subchunk1Size (16 for PCM)
  view.setUint16(offset, format, true); offset += 2; // AudioFormat (1 for PCM)
  view.setUint16(offset, numChannels, true); offset += 2; // NumChannels
  view.setUint32(offset, sampleRate, true); offset += 4; // SampleRate
  view.setUint32(offset, sampleRate * blockAlign, true); offset += 4; // ByteRate
  view.setUint16(offset, blockAlign, true); offset += 2; // BlockAlign
  view.setUint16(offset, bitDepth, true); offset += 2; // BitsPerSample
  
  // Data sub-chunk
  writeString(view, offset, 'data'); offset += 4;
  view.setUint32(offset, dataSize, true); offset += 4;
  
  // Write PCM samples
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(-1, Math.min(1, data[i])); // Clamp
    // Convert float to 16-bit PCM
    const pcm = s < 0 ? s * 0x8000 : s * 0x7FFF;
    view.setInt16(offset, pcm, true);
    offset += 2;
  }
  
  // Convert ArrayBuffer to Base64
  let binary = '';
  const bytes = new Uint8Array(arrayBuffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  
  return `data:audio/wav;base64,${btoa(binary)}`;
};

/**
 * Helper to strip the data URI prefix (e.g. "data:image/png;base64,") to get raw base64
 */
const getRawBase64 = (dataUrl: string) => {
  return dataUrl.split(',')[1];
};

/**
 * Helper to identify extension from data URI
 */
const getExtension = (dataUrl: string) => {
  const match = dataUrl.match(/^data:([^;]+);/);
  const mime = match ? match[1] : 'image/jpeg';
  if (mime === 'image/png') return 'png';
  if (mime === 'audio/wav') return 'wav';
  return 'jpg';
};

/**
 * Shared HTML Template logic
 */
const getHtmlTemplate = (storyJsonString: string, audioMapString: string) => {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Interactive Storybook</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@0,400;0,700;1,400&family=Nunito:wght@400;700&display=swap');

        :root {
            --bg-color: #0f172a; /* Slate 900 */
            --book-bg: #fdfbf7;
            --text-color: #1e293b;
            --accent-color: #f59e0b; /* Amber 500 */
            --indigo-900: #312e81;
        }

        body {
            margin: 0;
            padding: 0;
            background-color: var(--bg-color);
            font-family: 'Nunito', sans-serif;
            height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            overflow: hidden;
        }

        #app {
            width: 100%;
            height: 100%;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
        }

        .book-container {
            position: relative;
            width: 90%;
            max-width: 1200px;
            aspect-ratio: 16/9;
            background-color: var(--book-bg);
            border-radius: 12px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
            border: 12px solid var(--indigo-900);
            perspective: 2000px; /* Enable 3D perspective */
            display: flex;
        }

        @media (max-width: 768px) {
            .book-container {
                aspect-ratio: 4/5;
                flex-direction: column;
                height: 80vh;
            }
        }

        /* 3D Flip Animations */
        @keyframes pageTurnNext {
            0% { opacity: 0; transform: rotateY(-90deg); transform-origin: left center; }
            100% { opacity: 1; transform: rotateY(0deg); transform-origin: left center; }
        }
        @keyframes pageTurnPrev {
            0% { opacity: 0; transform: rotateY(90deg); transform-origin: right center; }
            100% { opacity: 1; transform: rotateY(0deg); transform-origin: right center; }
        }

        .animate-flip-next {
            animation: pageTurnNext 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
        }
        .animate-flip-prev {
            animation: pageTurnPrev 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
        }

        /* Page Content Wrapper */
        .page-wrapper {
            width: 100%;
            height: 100%;
            display: flex;
            transform-style: preserve-3d;
            background-color: var(--book-bg);
            border-radius: 8px;
            overflow: hidden;
        }
        @media (max-width: 768px) {
            .page-wrapper {
                flex-direction: column;
            }
        }

        /* Cover Styles */
        .cover-view {
            width: 100%;
            height: 100%;
            background-color: var(--indigo-900);
            position: relative;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
            color: #fffbeb; /* Amber 50 */
        }

        .cover-bg {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            object-fit: cover;
            opacity: 0.6;
            transition: transform 10s ease;
        }
        
        .cover-view:hover .cover-bg {
            transform: scale(1.05);
        }

        .cover-overlay {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(to top, rgba(30, 27, 75, 0.9), rgba(30, 27, 75, 0.5), rgba(30, 27, 75, 0.2));
            z-index: 1;
        }

        .cover-content {
            position: relative;
            z-index: 10;
            padding: 2rem;
        }

        h1 {
            font-family: 'Crimson Pro', serif;
            font-size: 4rem;
            margin: 0;
            text-shadow: 0 4px 6px rgba(0,0,0,0.3);
        }

        .subtitle {
            font-family: 'Crimson Pro', serif;
            font-style: italic;
            font-size: 1.5rem;
            opacity: 0.9;
            margin-top: 1rem;
        }

        .start-btn {
            margin-top: 3rem;
            padding: 1rem 3rem;
            background-color: var(--accent-color);
            color: var(--indigo-900);
            border: none;
            border-radius: 9999px;
            font-weight: bold;
            font-size: 1.2rem;
            cursor: pointer;
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
            transition: transform 0.2s, background-color 0.2s;
        }
        .start-btn:hover {
            transform: scale(1.05);
            background-color: #fbbf24;
        }

        /* Page Styles */
        .page-view {
            display: flex;
            width: 100%;
            height: 100%;
        }

        .page-image-container {
            flex: 1;
            background-color: #e2e8f0;
            position: relative;
            overflow: hidden;
        }

        .page-image {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }

        .page-text-container {
            flex: 1;
            padding: 3rem;
            display: flex;
            flex-direction: column;
            justify-content: center;
            background-color: var(--book-bg);
            color: var(--text-color);
            position: relative;
            border-left: 1px solid #e2e8f0;
        }

        .story-text {
            font-family: 'Crimson Pro', serif;
            font-size: 1.8rem;
            line-height: 1.6;
        }

        .page-number {
            position: absolute;
            bottom: 2rem;
            right: 2rem;
            color: #94a3b8;
            font-size: 0.9rem;
        }

        /* End Page */
        .end-view {
            width: 100%;
            height: 100%;
            background-color: var(--indigo-900);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            color: white;
        }

        /* Navigation */
        .nav-btn {
            position: absolute;
            top: 50%;
            transform: translateY(-50%);
            background: rgba(255, 255, 255, 0.8);
            border: none;
            border-radius: 50%;
            width: 50px;
            height: 50px;
            font-size: 1.5rem;
            color: var(--indigo-900);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
            transition: background 0.2s;
            z-index: 20;
        }
        .nav-btn:hover {
            background: white;
        }
        .prev-btn { left: 1rem; }
        .next-btn { right: 1rem; }
        
        /* Audio Controls */
        .audio-btn {
            position: absolute;
            bottom: 2rem;
            left: 2rem;
            background: #eef2ff;
            color: #4f46e5;
            border: none;
            padding: 0.5rem 1rem;
            border-radius: 9999px;
            font-weight: bold;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            transition: all 0.2s;
            font-size: 0.9rem;
        }
        .audio-btn:hover {
            background: #e0e7ff;
        }
        .audio-btn.playing {
            background: #fef3c7;
            color: #92400e;
        }
        
        .hidden { display: none; }
    </style>
</head>
<body>

    <div id="app">
        <div class="book-container" id="book-container">
            <!-- Content Injected via JS -->
        </div>
    </div>

    <!-- Hidden audio element for playback -->
    <audio id="bg-audio"></audio>

    <script>
        const story = ${storyJsonString};
        const audioMap = ${audioMapString};
        
        let currentIndex = -1; // -1 is Cover
        const totalPages = story.pages.length;
        let direction = 'next';
        
        const container = document.getElementById('book-container');
        const audioElement = document.getElementById('bg-audio');
        let isPlaying = false;

        function toggleAudio(e) {
            e.stopPropagation();
            if (isPlaying) {
                audioElement.pause();
                isPlaying = false;
                render(); // Re-render to update button state
            } else {
                const src = audioMap[currentIndex];
                if (src) {
                    audioElement.src = src;
                    audioElement.play();
                    isPlaying = true;
                    render();
                } else {
                    alert("No audio generated for this page.");
                }
            }
        }

        // Listen for audio ending
        audioElement.onended = () => {
            isPlaying = false;
            // Optional: Auto advance logic could go here
            render();
        };

        function render() {
            // Apply animation class based on direction
            const animClass = direction === 'next' ? 'animate-flip-next' : 'animate-flip-prev';

            let innerHTML = '';

            // SVG Icons for Audio
            const playIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>';
            const stopIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><rect x="9" y="9" width="6" height="6"></rect></svg>';

            // CASE: Cover
            if (currentIndex === -1) {
                const coverImg = story.coverImageData || '';
                innerHTML = \`
                    <div class="page-wrapper \${animClass}">
                        <div class="cover-view">
                            \${coverImg ? \`<img src="\${coverImg}" class="cover-bg" />\` : ''}
                            <div class="cover-overlay"></div>
                            <div class="cover-content">
                                <h1>\${story.title}</h1>
                                <p class="subtitle">~ \${story.subtitle} ~</p>
                                <button class="start-btn" onclick="nextPage()">Read Story</button>
                            </div>
                        </div>
                    </div>
                \`;
            }

            // CASE: The End
            else if (currentIndex === totalPages) {
                innerHTML = \`
                    <div class="page-wrapper \${animClass}">
                        <div class="end-view">
                            <h1>The End</h1>
                            <p style="margin-top:2rem; opacity:0.7; font-style:italic">Created with DreamWeaver</p>
                            <button class="start-btn" onclick="restart()">Read Again</button>
                        </div>
                    </div>
                \`;
            }

            // CASE: Story Page
            else {
                const page = story.pages[currentIndex];
                const hasAudio = !!audioMap[currentIndex];
                
                innerHTML = \`
                    <div class="page-wrapper \${animClass}">
                        <div class="page-view">
                            <div class="page-image-container">
                                \${page.imageData ? \`<img src="\${page.imageData}" class="page-image" />\` : ''}
                            </div>
                            <div class="page-text-container">
                                <p class="story-text">\${page.text}</p>
                                <span class="page-number">\${currentIndex + 1} / \${totalPages}</span>
                                
                                \${hasAudio ? \`
                                    <button class="audio-btn \${isPlaying ? 'playing' : ''}" onclick="toggleAudio(event)">
                                        \${isPlaying ? stopIcon : playIcon}
                                        \${isPlaying ? 'Stop' : 'Read to Me'}
                                    </button>
                                \` : ''}
                            </div>
                            <button class="nav-btn prev-btn" onclick="prevPage()">&#8249;</button>
                            <button class="nav-btn next-btn" onclick="nextPage()">&#8250;</button>
                        </div>
                    </div>
                \`;
            }
            
            // Render content
            container.innerHTML = innerHTML;
        }

        function stopAudio() {
            audioElement.pause();
            audioElement.currentTime = 0;
            isPlaying = false;
        }

        function nextPage() {
            if (currentIndex < totalPages) {
                stopAudio();
                direction = 'next';
                currentIndex++;
                render();
            }
        }

        function prevPage() {
            if (currentIndex > -1) {
                stopAudio();
                direction = 'prev';
                currentIndex--;
                render();
            }
        }

        function restart() {
            stopAudio();
            direction = 'prev';
            currentIndex = -1;
            render();
        }

        // Handle Keyboard
        window.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowRight') nextPage();
            if (e.key === 'ArrowLeft') prevPage();
        });

        // Initial Render
        render();

    </script>
</body>
</html>`;
};

/**
 * Generates a standalone HTML file containing the story and a lightweight player.
 * This acts as a portable "app" that works offline.
 */
export const generateStandaloneHtml = (story: Story, audioMap: Record<number, string> = {}): string => {
  // Serialize the story data safely
  const storyJson = JSON.stringify(story).replace(/</g, '\\u003c');
  const audioJson = JSON.stringify(audioMap);
  
  return getHtmlTemplate(storyJson, audioJson);
};

/**
 * Generates a ZIP file containing the project structure suitable for GitHub Pages.
 * - index.html (Main entry point)
 * - assets/images/ (Images extracted)
 * - assets/audio/ (Audio extracted)
 * - README.md
 */
export const generateProjectZip = async (story: Story, audioMapBase64: Record<number, string> = {}): Promise<Blob> => {
    const zip = new JSZip();
    const assets = zip.folder("assets");
    const imgFolder = assets?.folder("images");
    const audioFolder = assets?.folder("audio");

    // 1. Prepare modified story object (referencing external files instead of Base64)
    const modifiedStory = JSON.parse(JSON.stringify(story)); // Deep clone
    const modifiedAudioMap: Record<number, string> = {};

    // 2. Extract Cover Image
    if (story.coverImageData) {
        const ext = getExtension(story.coverImageData);
        const filename = `cover.${ext}`;
        imgFolder?.file(filename, getRawBase64(story.coverImageData), { base64: true });
        
        // Update reference
        modifiedStory.coverImageData = `assets/images/${filename}`;
    }

    // 3. Extract Page Images
    story.pages.forEach((page, index) => {
        if (page.imageData) {
            const ext = getExtension(page.imageData);
            const filename = `page-${index}.${ext}`;
            imgFolder?.file(filename, getRawBase64(page.imageData), { base64: true });
            
            // Update reference
            modifiedStory.pages[index].imageData = `assets/images/${filename}`;
        }
    });

    // 4. Extract Audio
    Object.entries(audioMapBase64).forEach(([indexStr, base64Audio]) => {
        const index = parseInt(indexStr);
        const filename = `page-${index}.wav`;
        audioFolder?.file(filename, getRawBase64(base64Audio), { base64: true });
        
        // Update reference
        modifiedAudioMap[index] = `assets/audio/${filename}`;
    });

    // 5. Generate Index.html
    // We use the same template, but inject the JSON that points to local files
    const htmlContent = getHtmlTemplate(
        JSON.stringify(modifiedStory).replace(/</g, '\\u003c'), 
        JSON.stringify(modifiedAudioMap)
    );
    zip.file("index.html", htmlContent);

    // 6. Add README
    zip.file("README.md", `# ${story.title}
    
## About
This is an interactive storybook generated by DreamWeaver AI.

## How to Publish on GitHub Pages
1. Create a new repository on GitHub.
2. Upload all the files in this folder (including the 'assets' folder) to the repository.
3. Go to the repository **Settings** > **Pages**.
4. Under **Source**, select "Deploy from a branch" and choose "main" (or "master") and the "/ (root)" folder.
5. Click **Save**.
6. Wait a few minutes, and GitHub will give you a link to view your storybook online!

## Running Locally
You can simply open \`index.html\` in your browser to read the story locally.
`);

    return await zip.generateAsync({ type: "blob" });
};
