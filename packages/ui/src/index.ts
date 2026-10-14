export { cn } from './lib/cn';
export { Icon, type IconName, type IconProps } from './icons/Icon';
export { ICON_PATHS } from './icons/paths.generated';

export { Accordion, type AccordionItem, type AccordionProps } from './components/Accordion';
export { Avatar, sizedAvatarUrl, type AvatarProps } from './components/Avatar';
export { Button, buttonStyles, type ButtonProps } from './components/Button';
export { Card, type CardProps } from './components/Card';
export { ChecklistRule, type ChecklistRuleProps, type RuleStatus } from './components/ChecklistRule';
export { Chip, StateChip, type ChipProps, type StateChipProps } from './components/Chip';
export { Combobox, type ComboboxOption, type ComboboxProps } from './components/Combobox';
export { Dialog, type DialogProps } from './components/Dialog';
export { DropdownMenu, type DropdownMenuItem, type DropdownMenuProps } from './components/DropdownMenu';
export { EmptyState, type EmptyStateProps } from './components/EmptyState';
export { Field, controlStyles, type FieldProps } from './components/Field';
export {
  Input,
  Select,
  Textarea,
  type InputProps,
  type SelectOption,
  type SelectProps,
  type TextareaProps,
} from './components/Input';
export { Popover, type PopoverProps } from './components/Popover';
export { Skeleton, type SkeletonProps } from './components/Skeleton';
export { Tabs, type TabItem, type TabsProps } from './components/Tabs';
export { TerminalWindow, type TerminalLine, type TerminalWindowProps } from './components/TerminalWindow';
export { ToastProvider, useToast, type ToastInput, type ToastProviderProps, type ToastTone } from './components/Toast';
export { Tooltip, type TooltipProps } from './components/Tooltip';
export { UnlockCard, type UnlockCardProps } from './components/UnlockCard';
export { VisuallyHidden } from './components/VisuallyHidden';

export { CompanionView, type CompanionViewProps } from './companion/CompanionView';
export { SpeechBubble, type SpeechBubbleProps } from './companion/SpeechBubble';
export {
  COMPANION_TRAITS,
  MAX_STAGE,
  SPECIES_COUNT,
  generateFrames,
  hashSeed,
  speciesFor,
  type CompanionFrames,
  type CompanionInput,
  type CompanionState,
  type CompanionTrait,
} from './companion/generate';
export { renderSpriteSheet, renderStill, type SpriteSheetOptions } from './companion/render';
export { contrastRatio, derivePalette, outlineFor } from './companion/color';

export { ThemeToggle, type ThemeToggleProps } from './theme/ThemeToggle';
export {
  THEME_INIT_SCRIPT,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  isThemePreference,
  nextPreference,
  resolveTheme,
  type ResolvedTheme,
  type ThemePreference,
} from './theme/theme';
