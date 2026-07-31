/*
  Firebase web configuration.
  Paste the values from Firebase Console → Project settings → Your apps → SDK setup and configuration.
  These web-app values are public identifiers; Firestore Security Rules protect private data.
*/
window.AAKI_APP_CONFIG = {
  requireCloud: true,
  firebase: {
    apiKey: "",
    authDomain: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: ""
  },
  judge0Url: "https://ce.judge0.com",
  judge0AuthToken: ""
};
