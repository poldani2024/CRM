// js/auth.js
import { auth, providerGoogle, db } from "./firebase.js";

import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

export const TENANT_ID = "default";
export const ADMIN_EMAIL = "pedro.l.oldani@gmail.com";

/** Espera a que Auth tenga el usuario resuelto (o null) */
export function waitForAuthReady() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      resolve(user);
    });
  });
}

export function onSession(cb) {
  return onAuthStateChanged(auth, cb);
}

export async function loginGoogle() {
  // (desktop) popup. Si después querés, lo adaptamos a redirect en mobile.
  await signInWithPopup(auth, providerGoogle);
}

export async function logout() {
  await signOut(auth);
}

export async function getMyProfile() {
  const user = auth.currentUser || (await waitForAuthReady());
  if (!user) return null;

  const email = (user.email || "").toLowerCase();

  // Admin bootstrap por email
  if (email === ADMIN_EMAIL.toLowerCase()) {
    const ref = doc(db, "tenants", TENANT_ID, "users", user.uid);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      await setDoc(
        ref,
        {
          tenantId: TENANT_ID,
          uid: user.uid,
          email: user.email || "",
          displayName: user.displayName || "",
          role: "admin",
          active: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }

    return {
      tenantId: TENANT_ID,
      role: "admin",
      active: true,
      email: user.email,
      displayName: user.displayName,
      uid: user.uid,
    };
  }

  // Resto: perfil en Firestore
  const ref = doc(db, "tenants", TENANT_ID, "users", user.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    return {
      tenantId: TENANT_ID,
      role: "none",
      active: false,
      email: user.email,
      displayName: user.displayName,
      uid: user.uid,
    };
  }

  return snap.data();
}

/** Auto-registro "pendiente" (para que el admin lo apruebe después) */
export async function ensureUserRequestExists() {
  const user = auth.currentUser || (await waitForAuthReady());
  if (!user) return;

  const ref = doc(db, "tenants", TENANT_ID, "user_requests", user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return;

  await setDoc(
    ref,
    {
      tenantId: TENANT_ID,
      uid: user.uid,
      email: user.email || "",
      displayName: user.displayName || "",
      status: "pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/** Guard: requiere estar logueado y tener rol permitido */
export async function requireRole(allowedRoles = ["admin", "operator", "viewer"]) {
  const user = auth.currentUser || (await waitForAuthReady());
  if (!user) {
    window.location.href = "../index.html";
    return null;
  }

  const profile = await getMyProfile();
  const ok = profile?.active && allowedRoles.includes(profile.role);

  if (!ok) {
    window.location.href = "../pages/no_access.html";
    return null;
  }

  return profile;
}
