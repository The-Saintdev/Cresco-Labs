import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native'
import { FileText, Film, Image as ImageIcon, type LucideIcon } from 'lucide-react-native'
import { kindColor, radius, space, type Theme } from '@cresco/mobile-shared/tokens'
import { useThemeChoice } from './theme'

export type Kind = 'text' | 'image' | 'video'

export function useTheme(): Theme {
  return useThemeChoice().theme
}

export const kindIcon: Record<Kind, LucideIcon> = { text: FileText, image: ImageIcon, video: Film }

export function KindBadge({ kind, size = 34 }: { kind: Kind; size?: number }) {
  const theme = useTheme()
  const Icon = kindIcon[kind]
  return <View style={{ width: size, height: size, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bgSunken, borderWidth: 1, borderColor: theme.border }}>
    <Icon size={Math.round(size * 0.5)} color={kindColor(theme, kind)} />
  </View>
}

export function StatusPill({ status }: { status: 'complete' | 'failed' | 'queued' }) {
  const theme = useTheme()
  const tone = status === 'complete'
    ? { bg: theme.successWeak, fg: theme.success, label: 'Complete' }
    : status === 'failed'
      ? { bg: theme.dangerWeak, fg: theme.danger, label: 'Failed' }
      : { bg: theme.accentWeak, fg: theme.accent, label: 'Running' }
  return <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm, backgroundColor: tone.bg }}>
    <Text style={{ fontSize: 11, fontWeight: '600', color: tone.fg }}>{tone.label}</Text>
  </View>
}

export function Button({
  label, onPress, disabled, tone = 'primary', busy, icon: Icon, style,
}: {
  label: string
  onPress: () => void
  disabled?: boolean
  tone?: 'primary' | 'secondary' | 'danger'
  busy?: boolean
  icon?: LucideIcon
  style?: StyleProp<ViewStyle>
}) {
  const theme = useTheme()
  const background = tone === 'primary' ? theme.accent : tone === 'danger' ? theme.dangerWeak : theme.bgRaised
  const foreground = tone === 'primary' ? theme.accentText : tone === 'danger' ? theme.danger : theme.text
  return <TouchableOpacity
    accessibilityRole="button"
    disabled={disabled || busy}
    onPress={onPress}
    activeOpacity={0.8}
    style={[{
      minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      paddingHorizontal: space.lg, borderRadius: radius.md, backgroundColor: background,
      borderWidth: tone === 'secondary' ? 1 : 0, borderColor: theme.border,
      opacity: disabled || busy ? 0.45 : 1,
    }, style]}
  >
    {busy ? <ActivityIndicator size="small" color={foreground} /> : Icon ? <Icon size={16} color={foreground} /> : null}
    <Text style={{ fontSize: 14, fontWeight: '600', color: foreground }}>{label}</Text>
  </TouchableOpacity>
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme()
  return <View style={[{ backgroundColor: theme.bgRaised, borderWidth: 1, borderColor: theme.border, borderRadius: radius.lg }, style]}>{children}</View>
}

export function Empty({ title, text }: { title: string; text: string }) {
  const theme = useTheme()
  return <View style={{ alignItems: 'center', paddingVertical: 56, paddingHorizontal: space.xl, gap: 6 }}>
    <Text style={{ fontSize: 16, fontWeight: '600', color: theme.text }}>{title}</Text>
    <Text style={{ fontSize: 13, color: theme.textFaint, textAlign: 'center', lineHeight: 19 }}>{text}</Text>
  </View>
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  const theme = useTheme()
  return <View style={{ padding: space.md, borderRadius: radius.md, backgroundColor: theme.dangerWeak }}>
    <Text style={{ fontSize: 13, color: theme.danger, lineHeight: 19 }}>{children}</Text>
  </View>
}

export const sheet = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { padding: space.lg, paddingBottom: 48 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  grow: { flex: 1, minWidth: 0 },
})
