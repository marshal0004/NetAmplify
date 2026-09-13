// /home/z/my-project/netamplify-app/apps/frontend/src/lib/utils.ts
// NetAmplify — cn() helper for shadcn/ui (merges Tailwind classes).

import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
