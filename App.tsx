
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { generateStoryStructure, generatePageIllustration, analyzeStoryCharacters, generateImagePromptFromText } from './services/gemini';
import { getStory } from './services/storage';
import { Story, GenerationStatus, Character } from './types';
import { BookViewer } from './components/BookViewer';
import { Sparkles, Wand2, PenTool, Users, Plus, X, Upload, Image as ImageIcon, ArrowRight, Loader2, Book, Minus, AlertCircle } from 'lucide-react';

const App: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [pageCount, setPageCount] = useState(5);
  
  // Character Management State
  const [characters, setCharacters] = useState<Character[]>([]);
  // Temp state for manually adding extra characters in the customization screen
  const [tempCharName, setTempCharName] = useState('');
  const [tempCharRole, setTempCharRole] = useState('');
  const [tempCharImage, setTempCharImage] = useState<string | null>(null);
  
  // Initialize status based on URL to prevent flashing input screen on load
  const [status, setStatus] = useState<GenerationStatus>(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('storyId')) {
      return { step: 'analyzing', message: 'Loading story...' };
    }
    return { step: 'idle' };
  });

  const [story, setStory] = useState<Story | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- INITIALIZATION: CHECK FOR SHARED STORY ---
  const loadSharedStory = async () => {
      const params = new URLSearchParams(window.location.search);
      const storyId = params.get('storyId');

      if (storyId) {
        // Ensure status implies loading
        setStatus({ step: 'analyzing', message: 'Loading story...' });
        
        try {
          const loadedStory = await getStory(storyId);
          if (loadedStory) {
            setStory(loadedStory);
            setStatus({ step: 'complete' });
          } else {
            setStatus({ step: 'error', message: 'Story not found. It may have expired or was cleared from this device.' });
          }
        } catch (e) {
          console.error("Failed to load story", e);
          setStatus({ step: 'error', message: 'Could not load the story.' });
        }
      } else {
          // If no ID, revert to idle if we were expecting one
          if (status.step !== 'idle' && !story) {
             setStatus({ step: 'idle' });
          }
      }
  };

  useEffect(() => {
    loadSharedStory();

    // Listen for browser navigation (Back/Forward)
    const handlePopState = () => {
        loadSharedStory();
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Helper: Handle file reading
  const processFile = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });
  };

  const handleImageUploadForNewChar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const base64 = await processFile(file);
      setTempCharImage(base64);
    }
  };

  const handleImageUploadForExistingChar = async (id: string, file: File) => {
    const base64 = await processFile(file);
    setCharacters(prev => prev.map(c => c.id === id ? { ...c, imageData: base64 } : c));
  };

  const updateCharacterName = (id: string, newName: string) => {
    setCharacters(prev => prev.map(c => c.id === id ? { ...c, name: newName } : c));
  };

  const updateCharacterRole = (id: string, newRole: string) => {
    setCharacters(prev => prev.map(c => c.id === id ? { ...c, role: newRole } : c));
  };

  const addManualCharacter = () => {
    if (tempCharName.trim()) {
      setCharacters([
        ...characters,
        {
          id: Date.now().toString(),
          name: tempCharName.trim(),
          role: tempCharRole.trim() || 'Character',
          imageData: tempCharImage || ''
        }
      ]);
      setTempCharName('');
      setTempCharRole('');
      setTempCharImage(null);
    }
  };

  const removeCharacter = (id: string) => {
    setCharacters(characters.filter(c => c.id !== id));
  };

  const handlePageCountChange = (delta: number) => {
    setPageCount(prev => Math.max(3, Math.min(10, prev + delta)));
  };

  // --- EDITING LOGIC ---

  const handleUpdatePageText = (pageIndex: number, newText: string) => {
    setStory(current => {
      if (!current) return null;
      const newPages = [...current.pages];
      newPages[pageIndex] = { ...newPages[pageIndex], text: newText };
      return { ...current, pages: newPages };
    });
  };

  const handleRegeneratePageImage = async (pageIndex: number, newPrompt: string) => {
    if (!story) return;

    // 1. Set Loading
    setStory(current => {
      if (!current) return null;
      const newPages = [...current.pages];
      newPages[pageIndex] = { ...newPages[pageIndex], isLoadingImage: true, imagePrompt: newPrompt }; // Update prompt too
      return { ...current, pages: newPages };
    });

    try {
      // 2. Generate
      const base64Image = await generatePageIllustration(newPrompt, characters, story.visualStyle);

      // 3. Update Result
      setStory(current => {
        if (!current) return null;
        const newPages = [...current.pages];
        newPages[pageIndex] = { 
          ...newPages[pageIndex], 
          imageData: base64Image, 
          isLoadingImage: false 
        };
        return { ...current, pages: newPages };
      });
    } catch (e) {
      console.error("Failed to regenerate image", e);
      setStory(current => {
        if (!current) return null;
        const newPages = [...current.pages];
        newPages[pageIndex] = { ...newPages[pageIndex], isLoadingImage: false };
        return { ...current, pages: newPages };
      });
    }
  };
  
  const handleGeneratePromptFromText = async (text: string): Promise<string> => {
    if (!story) return '';
    return await generateImagePromptFromText(text, story.visualStyle, characters);
  };


  // STEP 1: Analyze prompt
  const analyzePrompt = async () => {
    if (!prompt.trim()) return;
    setStatus({ step: 'analyzing', message: 'Finding characters...' });

    try {
      const foundCharacters = await analyzeStoryCharacters(prompt);
      
      if (foundCharacters.length > 0) {
        // Map to our internal Character structure
        const mappedChars: Character[] = foundCharacters.map((c, i) => ({
          id: `auto-${i}-${Date.now()}`,
          name: c.name,
          role: c.role,
          imageData: '' // Empty initially
        }));
        setCharacters(mappedChars);
        setStatus({ step: 'customizing' });
      } else {
        // If no characters found, go straight to generation
        setStatus({ step: 'writing' });
        finalizeGeneration([]);
      }
    } catch (e) {
      console.error(e);
      // Fallback: just go to customization with empty list
      setCharacters([]);
      setStatus({ step: 'customizing' });
    }
  };

  // STEP 2: Start Generation (called from Customization or directly)
  const finalizeGeneration = useCallback(async (finalCharacters: Character[]) => {
    try {
      setStatus({ step: 'writing', message: 'Weaving your tale...' });
      const generatedStory = await generateStoryStructure(prompt, finalCharacters, pageCount);
      
      setStory({
        ...generatedStory,
        isLoadingCover: true,
        pages: generatedStory.pages.map(p => ({ ...p, isLoadingImage: true }))
      });
      
      setStatus({ step: 'illustrating', message: 'Drawing the magic...' });

      // 1. Generate Cover Image (In parallel with first page)
      generatePageIllustration(generatedStory.coverImagePrompt, finalCharacters, generatedStory.visualStyle)
        .then(coverImg => {
            setStory(current => current ? { ...current, coverImageData: coverImg, isLoadingCover: false } : null);
        })
        .catch(err => {
            console.error("Cover generation failed", err);
            setStory(current => current ? { ...current, isLoadingCover: false } : null);
        });

      // 2. Generate Page Illustrations SEQUENTIALLY to prevent Rate Limits
      // We process them one by one. The UI will update progressively.
      for (let index = 0; index < generatedStory.pages.length; index++) {
        const page = generatedStory.pages[index];
        try {
          // Update status message for better UX
          setStatus({ step: 'illustrating', message: `Drawing page ${index + 1} of ${generatedStory.pages.length}...` });

          const base64Image = await generatePageIllustration(page.imagePrompt, finalCharacters, generatedStory.visualStyle);
          
          setStory(currentStory => {
            if (!currentStory) return null;
            const newPages = [...currentStory.pages];
            newPages[index] = {
              ...newPages[index],
              imageData: base64Image,
              isLoadingImage: false
            };
            return { ...currentStory, pages: newPages };
          });
          
        } catch (err) {
          console.error(`Failed to generate image for page ${index}`, err);
          // Don't crash the loop, just mark this page as done (with placeholder or failed state)
          setStory(currentStory => {
            if (!currentStory) return null;
            const newPages = [...currentStory.pages];
            newPages[index] = {
              ...newPages[index],
              isLoadingImage: false
            };
            return { ...currentStory, pages: newPages };
          });
        }
      }

      setStatus({ step: 'complete' });

    } catch (error) {
      console.error(error);
      setStatus({ step: 'error', message: 'The magic spell failed. Please try again.' });
    }
  }, [prompt, pageCount]);

  const handleReset = () => {
    // Clear URL if we were in shared mode
    const url = new URL(window.location.href);
    url.searchParams.delete('storyId');
    window.history.pushState({}, '', url);

    setStory(null);
    setStatus({ step: 'idle' });
    setPrompt('');
    setPageCount(5);
    setCharacters([]);
    setTempCharName('');
    setTempCharRole('');
    setTempCharImage(null);
  };

  // RENDER HELPERS
  const renderInputView = () => (
    <div className="w-full max-w-2xl text-center space-y-8 animate-fade-in my-8">
      <header className="space-y-4">
        <div className="inline-flex items-center justify-center p-3 bg-indigo-800/50 rounded-full mb-4 shadow-inner ring-1 ring-white/10">
          <Sparkles className="text-amber-300 w-6 h-6 animate-pulse" />
        </div>
        <h1 className="text-5xl md:text-6xl font-serif font-bold bg-clip-text text-transparent bg-gradient-to-r from-amber-100 to-amber-300 pb-2">
          DreamWeaver
        </h1>
        <p className="text-xl text-indigo-200 font-light">
          Enter a simple idea, and watch it become a storybook.
        </p>
      </header>

      <div className="bg-white/5 backdrop-blur-lg border border-white/10 p-6 md:p-8 rounded-2xl shadow-2xl transition-all">
        <div className="space-y-6">
          {/* Prompt Input */}
          <div>
            <label htmlFor="prompt" className="flex items-center gap-2 text-left text-sm font-semibold text-indigo-300 mb-2 ml-1">
              <PenTool size={16} />
              What is your story about?
            </label>
            <textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. A brave little toaster who wants to go to Mars..."
              className="w-full h-32 bg-slate-800/50 border border-indigo-500/30 rounded-xl p-4 text-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all placeholder:text-slate-600 resize-none"
              disabled={status.step === 'analyzing'}
            />
          </div>

          {/* Page Count Control */}
          <div>
            <label className="flex items-center gap-2 text-left text-sm font-semibold text-indigo-300 mb-2 ml-1">
              <Book size={16} />
              Story Length (Pages)
            </label>
            <div className="flex items-center gap-4 bg-slate-800/50 border border-indigo-500/30 rounded-xl p-3 w-fit">
               <button 
                  onClick={() => handlePageCountChange(-1)} 
                  disabled={pageCount <= 3}
                  className="p-2 rounded-lg bg-indigo-900/50 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-indigo-200"
               >
                 <Minus size={18} />
               </button>
               <span className="text-xl font-serif font-bold w-12 text-center text-white">{pageCount}</span>
               <button 
                  onClick={() => handlePageCountChange(1)} 
                  disabled={pageCount >= 10}
                  className="p-2 rounded-lg bg-indigo-900/50 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-indigo-200"
               >
                 <Plus size={18} />
               </button>
            </div>
          </div>
        </div>

        <div className="mt-8 flex justify-end">
          <button
            onClick={analyzePrompt}
            disabled={!prompt || status.step === 'analyzing'}
            className={`
              flex items-center gap-3 px-8 py-4 rounded-xl font-bold text-lg transition-all transform
              ${!prompt || status.step === 'analyzing'
                ? 'bg-slate-700 text-slate-500 cursor-not-allowed' 
                : 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-lg hover:shadow-indigo-500/25 hover:-translate-y-1 hover:scale-[1.02] active:scale-95'}
            `}
          >
            {status.step === 'analyzing' ? (
              <>
                <Loader2 className="animate-spin" />
                Finding Characters...
              </>
            ) : (
              <>
                Next <ArrowRight />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  const renderCustomizationView = () => (
    <div className="w-full max-w-3xl text-center space-y-6 animate-fade-in my-8">
      <header className="mb-8">
        <h2 className="text-3xl font-serif font-bold text-amber-100">Meet the Cast</h2>
        <p className="text-indigo-200">Review the characters and upload photos to personalize them.</p>
      </header>

      <div className="bg-white/5 backdrop-blur-lg border border-white/10 p-6 rounded-2xl shadow-2xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {characters.map((char) => (
            <div key={char.id} className="relative bg-slate-800/60 rounded-xl p-4 border border-indigo-500/20 hover:border-indigo-500/50 transition-colors flex flex-col gap-3 text-left">
              <button 
                onClick={() => removeCharacter(char.id)}
                className="absolute top-2 right-2 p-1 text-slate-500 hover:text-red-400 transition-colors z-10"
                title="Remove Character"
              >
                <X size={16} />
              </button>

              <div className="flex items-start gap-4">
                {/* Photo Upload Area */}
                <div className="relative group shrink-0">
                  <div className={`w-16 h-16 rounded-full overflow-hidden border-2 ${char.imageData ? 'border-amber-500' : 'border-dashed border-indigo-400/30'} bg-slate-900 flex items-center justify-center`}>
                    {char.imageData ? (
                      <img src={char.imageData} alt={char.name} className="w-full h-full object-cover" />
                    ) : (
                      <Users className="text-indigo-400/30 w-8 h-8" />
                    )}
                  </div>
                  <label className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center rounded-full cursor-pointer transition-opacity">
                    <Upload size={14} className="text-white" />
                    <input 
                      type="file" 
                      accept="image/*" 
                      className="hidden" 
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleImageUploadForExistingChar(char.id, file);
                      }} 
                    />
                  </label>
                </div>

                <div className="flex-1 min-w-0">
                   {/* Editable Role */}
                   <input
                      type="text"
                      value={char.role || ''}
                      onChange={(e) => updateCharacterRole(char.id, e.target.value)}
                      className="w-full bg-transparent text-xs text-indigo-400 uppercase tracking-wider font-semibold mb-1 border-b border-transparent focus:border-indigo-500 outline-none placeholder:text-indigo-400/50 transition-colors"
                      placeholder="ROLE"
                  />
                  {/* Editable Name */}
                  <input
                    type="text"
                    value={char.name}
                    onChange={(e) => updateCharacterName(char.id, e.target.value)}
                    className="w-full bg-slate-900/50 border border-indigo-500/30 rounded px-2 py-1 text-slate-200 focus:border-amber-500 outline-none transition-colors"
                    placeholder="Name"
                  />
                </div>
              </div>
            </div>
          ))}

          {/* Add Manual Character Card */}
          <div className="bg-indigo-900/20 border border-dashed border-indigo-500/30 rounded-xl p-4 flex flex-col gap-3 justify-center items-center text-center">
            <div className="text-sm text-indigo-300 font-medium">Add Another?</div>
            <div className="flex flex-col w-full gap-2">
                <input
                    type="text"
                    value={tempCharRole}
                    onChange={(e) => setTempCharRole(e.target.value)}
                    placeholder="Role (e.g. The Villain)"
                    className="w-full bg-slate-900/50 border border-indigo-500/30 rounded px-2 py-1 text-sm outline-none focus:border-amber-500 transition-colors placeholder:text-slate-600"
                />
                <div className="flex w-full gap-2">
                    <input
                        type="text"
                        value={tempCharName}
                        onChange={(e) => setTempCharName(e.target.value)}
                        placeholder="Name"
                        className="flex-1 bg-slate-900/50 border border-indigo-500/30 rounded px-2 py-1 text-sm outline-none focus:border-amber-500 transition-colors placeholder:text-slate-600"
                    />
                    <input 
                        type="file" 
                        accept="image/*" 
                        ref={fileInputRef}
                        onChange={handleImageUploadForNewChar}
                        className="hidden" 
                    />
                    <button 
                        onClick={() => fileInputRef.current?.click()}
                        className={`p-2 rounded border transition-colors ${tempCharImage ? 'border-amber-500 text-amber-500 bg-amber-500/10' : 'border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-400'}`}
                        title="Upload Photo"
                    >
                        <ImageIcon size={16} />
                    </button>
                    <button 
                        onClick={addManualCharacter}
                        disabled={!tempCharName}
                        className="p-2 bg-indigo-600 text-white rounded hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="Add Character"
                    >
                        <Plus size={16} />
                    </button>
                </div>
            </div>
          </div>
        </div>

        <div className="flex justify-between pt-4 border-t border-white/10">
          <button 
            onClick={() => setStatus({ step: 'idle' })} // Go back
            className="text-slate-400 hover:text-white px-4 py-2"
          >
            Back
          </button>
          <button
            onClick={() => finalizeGeneration(characters)}
            className="flex items-center gap-3 px-8 py-3 rounded-xl font-bold text-lg bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-lg hover:shadow-amber-500/25 hover:-translate-y-1 transition-all"
          >
            <Wand2 size={20} />
            Create Storybook
          </button>
        </div>
      </div>
    </div>
  );

  const renderLoadingView = () => (
    <div className="w-full max-w-2xl text-center space-y-8 animate-fade-in my-8 flex flex-col items-center">
      <div className="relative w-32 h-32">
        <div className="absolute inset-0 border-4 border-indigo-500/30 rounded-full"></div>
        <div className="absolute inset-0 border-4 border-t-amber-500 rounded-full animate-spin"></div>
        <div className="absolute inset-0 flex items-center justify-center">
           <PenTool className="text-indigo-300 w-10 h-10 animate-bounce" />
        </div>
      </div>
      
      <div>
        <h2 className="text-3xl font-serif font-bold text-white mb-2">
          {status.step === 'analyzing' ? 'Reading story...' :
           status.step === 'writing' ? 'Writing Story...' : 'Drawing Illustrations...'}
        </h2>
        <p className="text-indigo-200 animate-pulse">{status.message}</p>
      </div>

      {status.step === 'error' && (
        <div className="mt-4 p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-sm flex flex-col items-center gap-2">
          <div className="flex items-center gap-2">
             <AlertCircle size={20} />
             {status.message}
          </div>
          <button onClick={handleReset} className="mt-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors text-white text-xs uppercase tracking-wider">Start Over</button>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans overflow-x-hidden selection:bg-amber-500 selection:text-white">
      {/* Background Ambience */}
      <div className="fixed inset-0 z-0 pointer-events-none">
         <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600/20 rounded-full blur-[128px]"></div>
         <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-amber-600/10 rounded-full blur-[128px]"></div>
      </div>

      <main className="relative z-10 container mx-auto px-4 py-8 flex flex-col items-center justify-center min-h-screen">
        
        {/* VIEW LOGIC */}
        {status.step === 'idle' || status.step === 'analyzing' ? (
           // If we have a story but are analyzing, it means we are loading shared. If not story, prompt.
           story ? renderLoadingView() : (status.step === 'analyzing' ? renderLoadingView() : renderInputView())
        ) : status.step === 'customizing' ? (
          renderCustomizationView()
        ) : status.step === 'writing' || status.step === 'illustrating' || status.step === 'error' ? (
          renderLoadingView()
        ) : (
          /* VIEW: BOOK VIEWER */
          <div className="w-full flex flex-col items-center animate-fade-in">
             {status.step === 'complete' && story && ( // Wait for at least text to be done
               <BookViewer 
                 story={story} 
                 onReset={handleReset}
                 onUpdatePageText={handleUpdatePageText}
                 onRegeneratePageImage={handleRegeneratePageImage}
                 onGeneratePromptFromText={handleGeneratePromptFromText}
               />
             )}
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
