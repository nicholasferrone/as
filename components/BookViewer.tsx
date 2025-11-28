
import React, { useState, useEffect, useRef } from 'react';
import { Story, StoryPage } from '../types';
import { generatePageAudio } from '../services/gemini';
import { generateEpub } from '../services/epubGenerator';
import { ChevronLeft, ChevronRight, Sparkles, BookOpen, RefreshCcw, Volume2, StopCircle, Loader2, Download, Edit2, RotateCcw, Check } from 'lucide-react';

interface BookViewerProps {
  story: Story;
  onReset: () => void;
  onUpdatePageText: (index: number, text: string) => void;
  onRegeneratePageImage: (index: number, prompt: string) => void;
  onGeneratePromptFromText: (text: string) => Promise<string>;
}

export const BookViewer: React.FC<BookViewerProps> = ({ story, onReset, onUpdatePageText, onRegeneratePageImage, onGeneratePromptFromText }) => {
  const [currentPageIndex, setCurrentPageIndex] = useState(-1); // Start at Cover (-1)
  const [direction, setDirection] = useState<'next' | 'prev'>('next');
  
  // Audio State
  const [isReading, setIsReading] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  
  // Edit Mode State
  const [isEditing, setIsEditing] = useState(false);
  const [tempImagePrompt, setTempImagePrompt] = useState('');
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);

  // Download State
  const [isDownloading, setIsDownloading] = useState(false);
  
  // Refs for audio management
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  // Cache stores both text and buffer to validate against edits
  const audioCacheRef = useRef<Map<number, { text: string, buffer: AudioBuffer }>>(new Map());
  
  // Ref to track isReading state inside event listeners (closure trap prevention)
  const isReadingRef = useRef(isReading);

  // Sync ref with state
  useEffect(() => {
    isReadingRef.current = isReading;
  }, [isReading]);

  // Logic to handle cover page (index -1) vs story pages (0 to N)
  const totalPages = story.pages.length;
  const isCover = currentPageIndex === -1;
  const isEnd = currentPageIndex === totalPages; // Back cover
  const isCoverLoading = story.isLoadingCover && !story.coverImageData;

  const handleNext = () => {
    if (currentPageIndex < totalPages) {
      setDirection('next');
      setCurrentPageIndex(prev => prev + 1);
      // Reset edit mode when turning page
      if (isEditing) setIsEditing(false);
    }
  };

  const handlePrev = () => {
    if (currentPageIndex > -1) {
      setDirection('prev');
      setCurrentPageIndex(prev => prev - 1);
      if (isEditing) setIsEditing(false);
    }
  };

  const handleRestart = () => {
    setIsReading(false);
    setCurrentPageIndex(-1);
    setDirection('prev');
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    // Disable navigation if loading or editing text
    if (isCoverLoading || (isEditing && document.activeElement?.tagName === 'TEXTAREA')) return; 
    
    if (e.key === 'ArrowRight') {
      setIsReading(false);
      handleNext();
    }
    if (e.key === 'ArrowLeft') {
      setIsReading(false);
      handlePrev();
    }
  };

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPageIndex, isCoverLoading, isEditing]);
  
  // Update temp prompt when page changes
  useEffect(() => {
      if (!isCover && !isEnd) {
          setTempImagePrompt(story.pages[currentPageIndex]?.imagePrompt || '');
      }
  }, [currentPageIndex, story.pages, isCover, isEnd]);

  // --- AUDIO LOGIC ---

  const getAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    return audioContextRef.current;
  };

  const stopAudioSource = () => {
    if (audioSourceRef.current) {
      try {
        audioSourceRef.current.stop();
        audioSourceRef.current.disconnect();
      } catch (e) {
        // Ignore if already stopped
      }
      audioSourceRef.current = null;
    }
  };

  // Helper: Determine text for a specific page index
  const getTextForIndex = (index: number): string => {
    if (index === -1) return `${story.title}. ${story.subtitle}`;
    if (index === totalPages) return ""; // End page has no audio usually
    return story.pages[index]?.text || "";
  };

  // Helper: Fetch audio for a specific page and cache it
  const fetchAudioForIndex = async (index: number): Promise<AudioBuffer | null> => {
    const currentText = getTextForIndex(index);
    if (!currentText) return null;

    // Check cache first
    if (audioCacheRef.current.has(index)) {
      const cached = audioCacheRef.current.get(index)!;
      // VALIDATE: Only return cached audio if the text hasn't changed
      if (cached.text === currentText) {
        return cached.buffer;
      }
    }

    try {
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') await ctx.resume();

      const buffer = await generatePageAudio(currentText, ctx);
      // Store buffer AND the text used to generate it
      audioCacheRef.current.set(index, { text: currentText, buffer });
      return buffer;
    } catch (error) {
      console.warn(`Pre-fetch failed for page ${index}`, error);
      return null;
    }
  };

  // Pre-fetch logic: Check next page audio
  const preloadNextPage = async () => {
    const nextIndex = currentPageIndex + 1;
    if (nextIndex <= totalPages) {
      // We check fetchAudioForIndex which now internally checks if cache is valid for the text
      await fetchAudioForIndex(nextIndex);
    }
  };

  // Main Effect: Orchestrates playback when Page or Reading State changes
  useEffect(() => {
    let active = true;

    const playCurrentPage = async () => {
      // Always try to preload the NEXT page immediately to reduce latency for the next turn
      preloadNextPage();

      // 1. If not reading, ensure everything is stopped
      if (!isReading) {
        stopAudioSource();
        setIsLoadingAudio(false);
        return;
      }

      // 2. Stop previous audio before starting new one
      stopAudioSource();

      if (isEnd) {
        setIsReading(false);
        return;
      }

      const textToRead = getTextForIndex(currentPageIndex);
      if (!textToRead) return;

      // 3. Get Audio (Cache or Fetch)
      setIsLoadingAudio(true);

      try {
        let audioBuffer: AudioBuffer | undefined;
        
        // Try getting valid cache or fetching new
        const buffer = await fetchAudioForIndex(currentPageIndex);
        if (buffer) audioBuffer = buffer;

        if (!active || !audioBuffer) return; 

        const ctx = getAudioContext();
        if (ctx.state === 'suspended') await ctx.resume();

        // 4. Play
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);

        // Auto-Advance Logic
        source.onended = () => {
          if (isReadingRef.current && active) {
            setTimeout(() => {
               if (isReadingRef.current && active) {
                  handleNext(); 
               }
            }, 500);
          }
        };

        audioSourceRef.current = source;
        source.start();
      } catch (error) {
        console.error("Audio playback error:", error);
        if (active) setIsReading(false);
      } finally {
        if (active) setIsLoadingAudio(false);
      }
    };

    playCurrentPage();

    return () => {
      active = false;
      stopAudioSource();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPageIndex, isReading, story]); // Re-runs when story changes (e.g. text edit)


  const toggleReadAloud = () => {
    if (isEditing) setIsEditing(false); // Exit edit mode if starting read
    setIsReading(prev => !prev);
  };
  
  // --- AUTO PROMPT LOGIC ---
  const handleAutoPrompt = async () => {
    if (!currentPageData || isGeneratingPrompt) return;
    setIsGeneratingPrompt(true);
    try {
        const newPrompt = await onGeneratePromptFromText(currentPageData.text);
        setTempImagePrompt(newPrompt);
    } catch (e) {
        console.error("Failed to generate prompt from text", e);
    } finally {
        setIsGeneratingPrompt(false);
    }
  };

  // --- DOWNLOAD EPUB LOGIC ---
  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const blob = await generateEpub(story);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${story.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.epub`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Download failed", e);
      alert("Failed to generate eBook.");
    } finally {
      setIsDownloading(false);
    }
  };
  
  // --- RENDER ---

  const currentPageData: StoryPage | undefined = !isCover && !isEnd ? story.pages[currentPageIndex] : undefined;

  // Helper for Read Aloud Button
  const ReadAloudButton = ({ dark = false }: { dark?: boolean }) => (
      <button 
          onClick={(e) => { e.stopPropagation(); toggleReadAloud(); }}
          className={`
          flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold transition-all shadow-sm
          ${dark 
              ? (isReading ? 'bg-amber-500 text-indigo-900' : 'bg-white/20 hover:bg-white/30 text-white backdrop-blur-md') 
              : (isReading ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100')
          }
          `}
          title={isReading ? "Stop Auto-Read" : "Read Aloud"}
      >
          {isLoadingAudio ? (
              <Loader2 size={18} className="animate-spin" />
          ) : isReading ? (
              <StopCircle size={18} />
          ) : (
              <Volume2 size={18} />
          )}
          <span>{isReading ? 'Stop Reading' : 'Read to Me'}</span>
      </button>
  );

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] w-full max-w-5xl mx-auto p-4">
      {/* Controls Top */}
      <div className="w-full flex justify-between items-center mb-6">
        <button 
          onClick={onReset}
          className="flex items-center gap-2 text-indigo-200 hover:text-white transition-colors"
        >
          <BookOpen size={20} />
          <span className="text-sm font-semibold uppercase tracking-wider">New Story</span>
        </button>
        <div className="text-white/50 text-sm font-sans">
          {isCover ? "Cover" : isEnd ? "The End" : `Page ${currentPageIndex + 1} of ${totalPages}`}
        </div>
      </div>

      {/* Book Container with Perspective */}
      <div className="relative w-full aspect-[4/5] md:aspect-[3/2] lg:aspect-[16/9] bg-[#fdfbf7] rounded-xl shadow-2xl flex flex-col md:flex-row border-[12px] border-indigo-950 perspective-[2000px]">
        
        {/* Animated Wrapper for Page Flip */}
        <div 
          key={currentPageIndex}
          className={`w-full h-full flex flex-col md:flex-row rounded-lg overflow-hidden transform-style-3d 
            ${direction === 'next' ? 'animate-page-turn-next origin-left' : 'animate-page-turn-prev origin-right'}
          `}
        >
            {/* Case: Front Cover */}
            {isCover && (
              <div className="w-full h-full flex flex-col items-center justify-center p-12 text-center bg-indigo-900 text-amber-50 relative overflow-hidden group">
                {/* Background Image Layer */}
                {story.coverImageData ? (
                  <>
                    <img 
                        src={story.coverImageData} 
                        alt="Cover Art" 
                        className="absolute inset-0 w-full h-full object-cover transition-transform duration-[20s] ease-in-out group-hover:scale-110" 
                    />
                    {/* Dark Overlay for Text Readability */}
                    <div className="absolute inset-0 bg-gradient-to-t from-indigo-950/90 via-indigo-950/60 to-indigo-950/20"></div>
                  </>
                ) : (
                  <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')]"></div>
                )}
                
                {/* Loading State for Cover */}
                {isCoverLoading && (
                  <div className="absolute top-4 right-4 text-white/50 flex items-center gap-2 text-xs uppercase tracking-widest">
                    <Loader2 className="animate-spin w-4 h-4" /> Painting Cover...
                  </div>
                )}

                {/* Cover Content */}
                <div className="relative z-10 flex flex-col items-center">
                    <Sparkles className="w-16 h-16 mb-6 text-amber-300 animate-pulse drop-shadow-[0_0_10px_rgba(251,191,36,0.6)]" />
                    <h1 className="text-4xl md:text-6xl font-serif font-bold mb-4 leading-tight drop-shadow-2xl">{story.title}</h1>
                    
                    {/* Subtitle with fade-in animation, only show if NOT loading */}
                    <p className={`text-lg md:text-xl opacity-90 mt-4 font-serif italic text-indigo-100 transition-opacity duration-1000 ${isCoverLoading ? 'opacity-0' : 'opacity-100'}`}>
                      ~ {story.subtitle} ~
                    </p>
                    
                    {/* Buttons - Hidden until cover loads */}
                    <div className={`flex gap-4 mt-12 transition-all duration-1000 ${isCoverLoading ? 'opacity-0 translate-y-4 pointer-events-none' : 'opacity-100 translate-y-0'}`}>
                        <button 
                            onClick={handleNext} 
                            className="px-8 py-3 bg-amber-500 hover:bg-amber-400 text-indigo-950 font-bold rounded-full transition-transform hover:scale-105 shadow-lg flex items-center gap-2"
                        >
                            Read Story <ChevronRight size={20} />
                        </button>
                        
                        {/* Read Aloud on Cover */}
                        <ReadAloudButton dark={true} />
                    </div>
                </div>
              </div>
            )}

            {/* Case: Story Pages */}
            {!isCover && !isEnd && currentPageData && (
              <>
                {/* Left Page (Image) */}
                <div className="w-full md:w-1/2 h-1/2 md:h-full bg-slate-200 relative overflow-hidden group">
                  {currentPageData.imageData ? (
                    <div className="w-full h-full relative">
                        <img 
                          src={currentPageData.imageData} 
                          alt="Story illustration" 
                          className={`w-full h-full object-cover animate-fade-in ${currentPageData.isLoadingImage ? 'opacity-50 blur-sm' : ''} transition-all`}
                        />
                        {currentPageData.isLoadingImage && (
                          <div className="absolute inset-0 flex items-center justify-center bg-indigo-900/30 backdrop-blur-sm z-10">
                              <Loader2 size={40} className="text-white animate-spin" />
                          </div>
                        )}
                    </div>
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center bg-indigo-50 text-indigo-300">
                      <div className="animate-spin mb-4">
                        <RefreshCcw size={32} />
                      </div>
                      <p className="text-sm font-sans uppercase tracking-widest">Illustrating...</p>
                    </div>
                  )}

                  {/* Edit Overlay for Image */}
                  {isEditing && (
                    <div className="absolute inset-x-0 bottom-0 p-4 bg-indigo-950/80 backdrop-blur-md border-t border-indigo-500/30 animate-fade-in z-20">
                      <div className="flex flex-col gap-2">
                          <div className="flex justify-between items-end mb-1">
                              <label className="text-indigo-200 text-xs font-bold uppercase tracking-wider">Image Prompt</label>
                              <button 
                                onClick={handleAutoPrompt}
                                disabled={isGeneratingPrompt}
                                className="text-amber-400 hover:text-amber-300 text-xs font-bold flex items-center gap-1 disabled:opacity-50 transition-colors"
                                title="Automatically update prompt based on current story text"
                              >
                                {isGeneratingPrompt ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                                Generate from Text
                              </button>
                          </div>
                          <textarea 
                            value={tempImagePrompt}
                            onChange={(e) => setTempImagePrompt(e.target.value)}
                            className="w-full h-20 bg-black/40 border border-indigo-500/30 rounded p-2 text-sm text-indigo-100 focus:outline-none focus:border-amber-500 resize-none"
                          />
                          <button 
                            onClick={() => onRegeneratePageImage(currentPageIndex, tempImagePrompt)}
                            disabled={currentPageData.isLoadingImage || isGeneratingPrompt}
                            className="self-end px-3 py-1 bg-amber-500 hover:bg-amber-400 text-indigo-950 text-sm font-bold rounded flex items-center gap-2 disabled:opacity-50"
                          >
                            {currentPageData.isLoadingImage ? <Loader2 size={14} className="animate-spin"/> : <RefreshCcw size={14} />}
                            Redraw
                          </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Right Page (Text) */}
                <div className="w-full md:w-1/2 h-1/2 md:h-full p-8 md:p-12 flex flex-col justify-center items-start bg-[#fdfbf7] relative border-l border-slate-100">
                  
                  {isEditing ? (
                      <textarea
                        value={currentPageData.text}
                        onChange={(e) => onUpdatePageText(currentPageIndex, e.target.value)}
                        className="w-full h-full bg-indigo-50/50 p-4 rounded-lg border-2 border-indigo-200 focus:border-amber-400 focus:ring-0 outline-none font-serif text-xl md:text-2xl lg:text-3xl leading-relaxed text-slate-800 resize-none"
                        autoFocus
                      />
                  ) : (
                      <p className="font-serif text-xl md:text-2xl lg:text-3xl leading-relaxed text-slate-800 animate-fade-in">
                        {currentPageData.text}
                      </p>
                  )}
                  
                  <div className="mt-auto w-full flex justify-between items-center pt-8 border-t border-slate-100">
                    <span className="text-slate-300 font-sans text-xs">{currentPageIndex + 1}</span>
                    <div className="flex items-center gap-2">
                        {/* Toggle Edit Mode */}
                        <button 
                          onClick={() => {
                              // Stop reading if starting to edit
                              if (!isEditing) setIsReading(false);
                              setIsEditing(!isEditing);
                          }}
                          className={`p-2 rounded-full transition-colors ${isEditing ? 'bg-indigo-600 text-white shadow-inner' : 'bg-indigo-50 text-indigo-400 hover:bg-indigo-100'}`}
                          title={isEditing ? "Done Editing" : "Edit Page"}
                        >
                          {isEditing ? <Check size={18} /> : <Edit2 size={18} />}
                        </button>
                        
                        <ReadAloudButton />
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Case: Back Cover */}
            {isEnd && (
              <div className="w-full h-full flex flex-col items-center justify-center p-12 text-center bg-indigo-950 text-white animate-fade-in">
                <h2 className="text-3xl md:text-5xl font-serif font-bold mb-6">The End</h2>
                
                <div className="flex flex-col gap-4">
                  {/* Primary: Download EPUB */}
                  <button 
                    onClick={handleDownload}
                    disabled={isDownloading}
                    className="px-8 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-full transition-all flex items-center gap-2 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed justify-center"
                  >
                    {isDownloading ? <Loader2 className="animate-spin" size={20} /> : <Download size={20} />}
                    {isDownloading ? 'Building eBook...' : 'Download eBook (.epub)'}
                  </button>

                  {/* New: Read Again */}
                  <button 
                    onClick={handleRestart}
                    className="px-8 py-3 bg-indigo-500/20 hover:bg-indigo-500/40 text-indigo-100 font-bold rounded-full transition-all flex items-center justify-center gap-2 backdrop-blur-sm"
                  >
                    <RotateCcw size={20} />
                    Read Again
                  </button>

                  {/* Tertiary: Restart */}
                  <button 
                    onClick={onReset}
                    className="px-6 py-3 border-2 border-white/30 hover:bg-white/10 rounded-lg transition-all text-sm uppercase tracking-wider text-indigo-200 hover:text-white"
                  >
                    Create Another Story
                  </button>
                </div>
              </div>
            )}
        </div>
        
        {/* Navigation Buttons (Overlay) */}
        {!isCover && !isEnd && (
          <>
            <button 
              onClick={() => { setIsReading(false); handlePrev(); }}
              className="absolute left-2 md:left-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/80 hover:bg-white text-indigo-900 shadow-lg backdrop-blur-sm transition-all z-10"
              aria-label="Previous page"
            >
              <ChevronLeft size={24} />
            </button>
            <button 
              onClick={() => { setIsReading(false); handleNext(); }}
              className="absolute right-2 md:right-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/80 hover:bg-white text-indigo-900 shadow-lg backdrop-blur-sm transition-all z-10"
              aria-label="Next page"
            >
              <ChevronRight size={24} />
            </button>
          </>
        )}

      </div>
    </div>
  );
};
