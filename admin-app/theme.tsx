import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useColorScheme } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import { themes, type Theme } from '@cresco/mobile-shared/tokens'

export type ThemeChoice = 'system' | 'light' | 'dark'

const STORE_KEY = 'cresco_theme_choice'

const ThemeContext = createContext<{ theme: Theme; choice: ThemeChoice; setChoice: (value: ThemeChoice) => void }>({
  theme: themes.light,
  choice: 'system',
  setChoice: () => {},
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const device = useColorScheme()
  const [choice, setChoiceState] = useState<ThemeChoice>('system')

  useEffect(() => {
    let alive = true
    SecureStore.getItemAsync(STORE_KEY)
      .then(value => {
        if (!alive) return
        if (value === 'light' || value === 'dark' || value === 'system') setChoiceState(value)
      })
      .catch(() => undefined)
    return () => { alive = false }
  }, [])

  const setChoice = (value: ThemeChoice) => {
    setChoiceState(value)
    void SecureStore.setItemAsync(STORE_KEY, value).catch(() => undefined)
  }

  const resolved = choice === 'system' ? (device === 'dark' ? 'dark' : 'light') : choice
  const value = useMemo(() => ({ theme: themes[resolved], choice, setChoice }), [resolved, choice])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useThemeChoice() {
  return useContext(ThemeContext)
}
