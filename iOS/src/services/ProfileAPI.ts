/**
 * X-Posed Mobile App - Profile API Service
 * Fetches user profile data including profile images
 */

import { Session } from '../types';

// Profile API Configuration
const PROFILE_API_CONFIG = {
  QUERY_ID: 'Yka-W8dz7RaEuQNkroPkYw',  // UserByScreenName query ID
  BASE_URL: 'https://x.com/i/api/graphql',
  BEARER_TOKEN: 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
  TIMEOUT_MS: 8000,
};

export interface UserProfile {
  id: string;
  screenName: string;
  name: string;
  profileImageUrl: string;
  profileBannerUrl?: string;
  description?: string;
  followersCount?: number;
  followingCount?: number;
  isVerified?: boolean;
  isBlueVerified?: boolean;
}

/**
 * Fetch user profile data including profile image
 */
export async function fetchUserProfile(
  username: string,
  session: Session
): Promise<UserProfile | null> {
  if (!session || !session.authToken || !session.csrfToken) {
    return null;
  }

  const cleanUsername = username.toLowerCase().trim().replace(/^@/, '');
  
  if (!cleanUsername || cleanUsername.length > 15) {
    return null;
  }

  try {
    const variables = {
      screen_name: cleanUsername,
      withSafetyModeUserFields: true,
    };

    const features = {
      hidden_profile_subscriptions_enabled: true,
      rweb_tipjar_consumption_enabled: true,
      responsive_web_graphql_exclude_directive_enabled: true,
      verified_phone_label_enabled: false,
      subscriptions_verification_info_is_identity_verified_enabled: true,
      subscriptions_verification_info_verified_since_enabled: true,
      highlights_tweets_tab_ui_enabled: true,
      responsive_web_twitter_article_notes_tab_enabled: true,
      subscriptions_feature_can_gift_premium: true,
      creator_subscriptions_tweet_preview_api_enabled: true,
      responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
      responsive_web_graphql_timeline_navigation_enabled: true,
    };

    const fieldToggles = {
      withAuxiliaryUserLabels: false,
    };

    const url = `${PROFILE_API_CONFIG.BASE_URL}/${PROFILE_API_CONFIG.QUERY_ID}/UserByScreenName?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}&fieldToggles=${encodeURIComponent(JSON.stringify(fieldToggles))}`;

    const headers: Record<string, string> = {
      'authorization': `Bearer ${PROFILE_API_CONFIG.BEARER_TOKEN}`,
      'x-csrf-token': session.csrfToken,
      'x-twitter-active-user': 'yes',
      'x-twitter-auth-type': 'OAuth2Session',
      'content-type': 'application/json',
      'accept-language': 'en-US,en;q=0.9',
      'cookie': `auth_token=${session.authToken}; ct0=${session.csrfToken}`,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PROFILE_API_CONFIG.TIMEOUT_MS);

    const response = await fetch(url, {
      method: 'GET',
      headers,
      credentials: 'include',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    
    // Parse the response
    const userResult = data?.data?.user?.result;
    if (!userResult) {
      return null;
    }

    // Handle the legacy (typename-based) response
    const legacy = userResult.legacy || userResult;
    
    // Get profile image URL and make it larger (replace _normal with _400x400)
    let profileImageUrl = legacy.profile_image_url_https || '';
    if (profileImageUrl) {
      // X returns _normal size by default (48x48), upgrade to _400x400
      profileImageUrl = profileImageUrl.replace('_normal.', '_400x400.');
    }

    const profile: UserProfile = {
      id: userResult.rest_id || userResult.id_str || '',
      screenName: legacy.screen_name || cleanUsername,
      name: legacy.name || '',
      profileImageUrl,
      profileBannerUrl: legacy.profile_banner_url,
      description: legacy.description,
      followersCount: legacy.followers_count,
      followingCount: legacy.friends_count,
      isVerified: legacy.verified,
      isBlueVerified: userResult.is_blue_verified,
    };

    return profile;

  } catch (error: any) {
    return null;
  }
}

/**
 * Get profile image URL directly (without full profile fetch)
 * Uses X's CDN pattern for profile images
 * Note: This is a fallback - full profile fetch is more reliable
 */
export function getDefaultProfileImageUrl(username: string): string {
  // Return empty string - we can't construct profile URLs without user ID
  // The actual profile image URL requires the user ID which we don't have
  return '';
}

export default { fetchUserProfile, getDefaultProfileImageUrl };