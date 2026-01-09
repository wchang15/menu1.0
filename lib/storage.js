// lib/storage.js
import { get, set, del, clear } from "idb-keyval";
import {
  downloadAssetBlob,
  downloadJsonAsset,
  uploadAsset,
  uploadJsonAsset,
} from "./cloudAssets";
import { getCurrentUser } from "./session";

export const KEYS = {
  INTRO_VIDEO: "introVideoBlob",
  MENU_BG: "menuBackgroundBlob",
  MENU_LAYOUT: "menuLayoutJson",
};

const LEGACY_BG_OVERRIDES_KEY = "MENU_BG_OVERRIDES_V1";

function getCloudAssetKey(key) {
  if (key === KEYS.INTRO_VIDEO) return "intro-video";
  if (key === KEYS.MENU_BG) return "menu-bg";
  if (key === LEGACY_BG_OVERRIDES_KEY) return "menu-bg-overrides";

  const bgPagePrefix = `${KEYS.MENU_BG}__P`;
  if (key.startsWith(bgPagePrefix)) {
    const page = key.slice(bgPagePrefix.length);
    if (page) return `menu-bg-page-${page}`;
  }

  const menuLayoutPrefix = `${KEYS.MENU_LAYOUT}_`;
  if (key === KEYS.MENU_LAYOUT) return "menu-layout-en";
  if (key.startsWith(menuLayoutPrefix)) {
    const lang = key.slice(menuLayoutPrefix.length) || "en";
    return `menu-layout-${lang}`;
  }

  return null;
}

function toFile(blob, filename, contentType) {
  if (typeof File !== "undefined" && blob instanceof File) {
    return blob;
  }

  if (typeof File === "undefined") {
    return blob;
  }

  return new File([blob], filename, {
    type: contentType || blob?.type || "application/octet-stream",
  });
}

function withUserScope(key) {
  const user = getCurrentUser();
  if (!user) return { key, user: null, cloudKey: getCloudAssetKey(key) };
  return { key: `${user}__${key}`, user, cloudKey: getCloudAssetKey(key) };
}

export async function saveBlob(key, blob, options = {}) {
  const { key: scopedKey, user, cloudKey } = withUserScope(key);
  await set(scopedKey, blob);

  if (user && cloudKey) {
    try {
      const file = toFile(blob, cloudKey, blob?.type);
      await uploadAsset({ assetKey: cloudKey, file, contentType: blob?.type });
    } catch (error) {
      if (options.throwOnCloudError) throw error;
      console.error("Failed to upload blob to cloud", error);
    }
  }
}

export async function loadBlob(key) {
  const { key: scopedKey, user, cloudKey } = withUserScope(key);

  if (user && cloudKey) {
    try {
      const remote = await downloadAssetBlob(cloudKey);
      if (remote) {
        await set(scopedKey, remote);
        return remote;
      }
    } catch (error) {
      console.error("Failed to download blob from cloud", error);
    }
  }

  const data = await get(scopedKey);
  if (data !== undefined && data !== null) {
    if (user && cloudKey) {
      try {
        const file = toFile(data, cloudKey, data?.type);
        await uploadAsset({ assetKey: cloudKey, file, contentType: data?.type });
      } catch (error) {
        console.error("Failed to migrate blob to cloud", error);
      }
    }
    return data;
  }

  // 이전(전역) 데이터가 있다면 현재 사용자 명의로 1회만 이동
  if (user && scopedKey !== key) {
    const fallback = await get(key);
    if (fallback !== undefined && fallback !== null) {
      await set(scopedKey, fallback);
      await del(key);
      if (cloudKey) {
        try {
          const file = toFile(fallback, cloudKey, fallback?.type);
          await uploadAsset({ assetKey: cloudKey, file, contentType: fallback?.type });
        } catch (error) {
          console.error("Failed to migrate legacy blob to cloud", error);
        }
      }
      return fallback;
    }
  }

  return data;
}

export async function saveJson(key, data, options = {}) {
  const { key: scopedKey, user, cloudKey } = withUserScope(key);
  await set(scopedKey, data);

  if (user && cloudKey) {
    try {
      await uploadJsonAsset({ assetKey: cloudKey, data });
    } catch (error) {
      if (options.throwOnCloudError) throw error;
      console.error("Failed to upload JSON to cloud", error);
    }
  }
}

export async function loadJson(key) {
  const { key: scopedKey, user, cloudKey } = withUserScope(key);

  if (user && cloudKey) {
    try {
      const remote = await downloadJsonAsset(cloudKey);
      if (remote !== null) {
        await set(scopedKey, remote);
        return remote;
      }
    } catch (error) {
      console.error("Failed to download JSON from cloud", error);
    }
  }

  const data = await get(scopedKey);
  if (data !== undefined && data !== null) {
    if (user && cloudKey) {
      try {
        await uploadJsonAsset({ assetKey: cloudKey, data });
      } catch (error) {
        console.error("Failed to migrate JSON to cloud", error);
      }
    }
    return data;
  }

  // 이전(전역) JSON이 있다면 현재 사용자 명의로 1회만 이동
  if (user && scopedKey !== key) {
    const fallback = await get(key);
    if (fallback !== undefined && fallback !== null) {
      await set(scopedKey, fallback);
      await del(key);
      if (cloudKey) {
        try {
          await uploadJsonAsset({ assetKey: cloudKey, data: fallback });
        } catch (error) {
          console.error("Failed to migrate legacy JSON to cloud", error);
        }
      }
      return fallback;
    }
  }

  return data;
}

export async function removeKey(key) {
  const { key: scopedKey } = withUserScope(key);
  await del(scopedKey);
}

// ✅ 추가: 전체 초기화
export async function resetAll() {
  await clear(); // idb-keyval이 쓰는 IndexedDB 전체 삭제
}
