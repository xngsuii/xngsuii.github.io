/* ============================================================
   FIREBASE 설정
   ------------------------------------------------------------
   Firebase 콘솔 > 프로젝트 설정(⚙) > 일반 > 내 앱 에서 받은 값.

   ※ 여기 있는 값들은 공개돼도 괜찮은 값입니다.
      실제 보안은 Firestore 보안 규칙(firestore.rules)이
      서버에서 담당합니다.
      비밀번호는 절대 이 파일에 적지 마세요.
   ============================================================ */

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCMqn4C1bRIiFPEheLz9cLIvDh5jvKNGo4",
  authDomain: "xngsuii-home.firebaseapp.com",
  projectId: "xngsuii-home",
  storageBucket: "xngsuii-home.firebasestorage.app",
  messagingSenderId: "620998385340",
  appId: "1:620998385340:web:4099f60bd96cd5e87afab9"
};

/* 편집 권한을 가진 관리자 계정의 UID
   (콘솔 > Authentication > Users 의 "사용자 UID") */
export const ADMIN_UID = "SOWckrcnF2VCZBOAU7sZdcYjV2g1";
