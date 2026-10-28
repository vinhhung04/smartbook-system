import { createContext, useContext } from 'react';

/**
 * Same parts, two voices: the staff portal is squarer and tighter, the reader
 * portal rounder and softer. Each shell provides its tone to the fields inside.
 */
export type AuthTone = 'staff' | 'customer';
export const AuthToneContext = createContext<AuthTone>('staff');
export const useAuthTone = () => useContext(AuthToneContext);
