import { create } from 'zustand';

interface ShopWizardState {
  shopId: string | null;
  brandName: string;
  websiteUrl: string;
  themeId: string | null;
  logoFile: File | null;
  logoPreview: string | null;
  headlineFont: string;
  bodyFont: string;
  primaryColor: string;
  secondaryColor: string;

  setBrandInfo: (name: string, url: string) => void;
  setShopId: (id: string) => void;
  setThemeId: (id: string) => void;
  setLogoFile: (file: File | null) => void;
  setFonts: (headline: string, body: string) => void;
  setColors: (primary: string, secondary: string) => void;
  reset: () => void;
  hydrateFromSnapshot: (params: { shopId?: string; themeId?: string }) => void;
}

const initialState = {
  shopId: null,
  brandName: '',
  websiteUrl: '',
  themeId: null,
  logoFile: null,
  logoPreview: null,
  headlineFont: '',
  bodyFont: '',
  primaryColor: '#000000',
  secondaryColor: '#686868',
};

export const useShopWizard = create<ShopWizardState>((set) => ({
  ...initialState,

  setBrandInfo: (brandName, websiteUrl) => set({ brandName, websiteUrl }),
  setShopId: (shopId) => set({ shopId }),
  setThemeId: (themeId) => set({ themeId }),
  setLogoFile: (file) =>
    set({
      logoFile: file,
      logoPreview: file ? URL.createObjectURL(file) : null,
    }),
  setFonts: (headlineFont, bodyFont) => set({ headlineFont, bodyFont }),
  setColors: (primaryColor, secondaryColor) => set({ primaryColor, secondaryColor }),
  reset: () => set(initialState),

  /** Hydrate from snapshot query params — used by reviewer pipeline */
  hydrateFromSnapshot: (params: { shopId?: string; themeId?: string }) => {
    if (params.shopId) set({ shopId: params.shopId });
    if (params.themeId) set({ themeId: params.themeId });
  },
}));
