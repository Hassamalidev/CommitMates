import { twMerge } from 'tailwind-merge';

type ClassValue = string | false | null | undefined;

/** Joins class names and resolves conflicting Tailwind utilities, last one wins. */
export function cn(...classes: ClassValue[]): string {
  return twMerge(classes.filter(Boolean).join(' '));
}
