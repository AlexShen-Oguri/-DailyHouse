import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
export type Language = 'zh' | 'en';
export type Theme = 'day' | 'night';
type Preferences = { language: Language; theme: Theme; setLanguage: (language: Language) => void; setTheme: (theme: Theme) => void; t: (zh: string, en: string) => string; locale: string };
const Context = createContext<Preferences>({ language: 'zh', theme: 'day', setLanguage: () => {}, setTheme: () => {}, t: zh => zh, locale: 'zh-CN' });
function read(key: string, fallback: string) { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } }
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [language, changeLanguage] = useState<Language>(() => read('dailyhouse-language', 'zh') === 'en' ? 'en' : 'zh');
  const [theme, changeTheme] = useState<Theme>(() => read('dailyhouse-theme', 'day') === 'night' ? 'night' : 'day');
  const setLanguage = (value: Language) => { document.documentElement.lang = value === 'zh' ? 'zh-CN' : 'en'; document.documentElement.dataset.language = value; changeLanguage(value); try { localStorage.setItem('dailyhouse-language', value); } catch { /* Keep the preference in memory. */ } };
  const setTheme = (value: Theme) => { changeTheme(value); try { localStorage.setItem('dailyhouse-theme', value); } catch { /* Keep the preference in memory. */ } };
  useEffect(() => { document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'; document.documentElement.dataset.language = language; document.title = language === 'zh' ? '日常小院 · 个人工作台' : 'DailyHouse · Personal workspace'; }, [language]);
  useEffect(() => { document.documentElement.dataset.theme = theme; document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'night' ? '#101a2d' : '#47704e'); }, [theme]);
  return <Context.Provider value={{ language, theme, setLanguage, setTheme, t: (zh, en) => language === 'zh' ? zh : en, locale: language === 'zh' ? 'zh-CN' : 'en-US' }}>{children}</Context.Provider>;
}
export const usePreferences = () => useContext(Context);
