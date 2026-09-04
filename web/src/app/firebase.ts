/**
 * Firebase is dynamically imported — the SDK only loads when someone actually
 * clicks "Sign in with Google", not on every page load (route-level code
 * splitting, same reasoning as the format libs in DesignerPage).
 */
import type { FirebaseWebConfig } from '@/api/types'

let appPromise: Promise<import('firebase/app').FirebaseApp> | null = null

function getApp(config: FirebaseWebConfig) {
  appPromise ??= import('firebase/app').then(({ initializeApp }) => initializeApp(config))
  return appPromise
}

/** Opens the Google sign-in popup and resolves to a Firebase ID token, ready
 *  to POST to /api/auth/firebase. Throws on popup-closed / blocked-popup /
 *  network errors — callers should catch and toast. */
export async function signInWithGoogle(config: FirebaseWebConfig): Promise<string> {
  const [{ getAuth, GoogleAuthProvider, signInWithPopup }, app] = await Promise.all([
    import('firebase/auth'),
    getApp(config),
  ])
  const result = await signInWithPopup(getAuth(app), new GoogleAuthProvider())
  return result.user.getIdToken()
}
