
export interface StoryPage {
  text: string;
  imagePrompt: string;
  imageData?: string; // Base64 string once generated
  isLoadingImage?: boolean;
}

export interface Story {
  title: string;
  subtitle: string;
  visualStyle: string; // e.g. "Watercolor illustration", "3D Render", "Paper cutout"
  coverImagePrompt: string;
  coverImageData?: string;
  isLoadingCover?: boolean;
  pages: StoryPage[];
}

export interface Character {
  id: string;
  role?: string; // e.g. "The Protagonist" or "The Villain"
  name: string;
  imageData: string; // Base64 string
}

export interface GenerationStatus {
  step: 'idle' | 'analyzing' | 'customizing' | 'writing' | 'illustrating' | 'complete' | 'error';
  message?: string;
}
