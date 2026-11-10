// Cloud save: Google sign-in (Firebase Auth) + one Firestore document per user at users/{uid}.
// The app stays local-first; this module just mirrors the data to the cloud and reports changes back.
// Share links: a public, read-only copy of the map at shares/{shareId}, kept up to date by its owner.

const SDK = 'https://www.gstatic.com/firebasejs/10.14.1';

/**
 * @param {object} config  Firebase web config, or null to disable.
 * @param {object} hooks   {onUser(user|null), onRemote(data|null, {first}), onStatus('saving'|'saved'|'offline'|'error')}
 * @returns {Promise<null | {signIn, signOut, push}>}
 */
export async function initCloud(config, hooks) {
  if (!config) return null;
  const [{ initializeApp }, authMod, fs] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut } = authMod;
  const { getFirestore, doc, setDoc, deleteDoc, onSnapshot, serverTimestamp } = fs;

  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app);

  let user = null;
  let unsubscribe = null;
  let pending = 0;

  const status = (s) => hooks.onStatus && hooks.onStatus(s);
  const refreshStatus = () => {
    if (!user) return;
    if (pending > 0) status(navigator.onLine ? 'saving' : 'offline');
  };
  window.addEventListener('online', refreshStatus);
  window.addEventListener('offline', refreshStatus);

  onAuthStateChanged(auth, (u) => {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    user = u;
    hooks.onUser(u ? { uid: u.uid, email: u.email, name: u.displayName } : null);
    if (!u) return;
    let first = true;
    unsubscribe = onSnapshot(doc(db, 'users', u.uid), (snap) => {
      if (snap.metadata.hasPendingWrites) return; // our own write echoing back
      hooks.onRemote(snap.exists() ? snap.data() : null, { first });
      first = false;
    }, (err) => {
      console.error('Cloud read failed', err);
      status('error');
    });
  });

  return {
    async signIn() {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        await signInWithPopup(auth, provider);
      } catch (err) {
        if (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment') {
          await signInWithRedirect(auth, provider);
        } else {
          throw err;
        }
      }
    },
    signOut: () => signOut(auth),
    /** Publish (or refresh) the public read-only copy behind a share link. Throws on failure. */
    async pushShare(shareId, data) {
      if (!user) throw Object.assign(new Error('Not signed in'), { code: 'unauthenticated' });
      await setDoc(doc(db, 'shares', shareId), { ...data, owner: user.uid, app: 'travel-map', updatedAt: serverTimestamp() });
    },
    /** Turn a share link off. Throws on failure. */
    async deleteShare(shareId) {
      await deleteDoc(doc(db, 'shares', shareId));
    },
    /** Save the whole data set to the cloud. Resolves once the server has it. */
    async push(data) {
      if (!user) return false;
      pending++;
      refreshStatus();
      try {
        await setDoc(doc(db, 'users', user.uid), { ...data, app: 'travel-map', updatedAt: serverTimestamp() });
        pending--;
        if (pending === 0) status('saved');
        return true;
      } catch (err) {
        pending--;
        console.error('Cloud save failed', err);
        status('error');
        return false;
      }
    },
  };
}

/** Read a shared map (no sign-in needed). Returns the data, or null if the link was turned off. */
export async function readSharedMap(config, shareId) {
  if (!config) throw new Error('Cloud not configured');
  const [{ initializeApp }, { getFirestore, doc, getDoc }] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const snap = await getDoc(doc(getFirestore(initializeApp(config)), 'shares', shareId));
  return snap.exists() ? snap.data() : null;
}
