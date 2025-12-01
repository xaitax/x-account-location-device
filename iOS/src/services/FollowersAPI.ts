/**
 * X-Posed Mobile App - Followers/Following API Service
 * Fetches user lists from X's GraphQL API for batch analysis
 */

import { Session } from '../types';

// API Configuration
const API_CONFIG = {
  BASE_URL: 'https://x.com/i/api/graphql',
  // Bearer token with proper = characters (not URL encoded)
  BEARER_TOKEN: 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
  TIMEOUT_MS: 15000,
  // GraphQL Query IDs (captured from X.com 2024-12-01)
  QUERY_IDS: {
    FOLLOWERS: 'SCu9fVIlCUm-BM8-tL5pkQ',
    BLUE_VERIFIED_FOLLOWERS: 'mtuBQZOWziVtBIcSLg6V_g',
    FOLLOWING: 'S5xUN9s2v4xk50KWGGvyvQ', // Updated 2024-12-01
    USER_BY_SCREEN_NAME: 'Yka-W8dz7RaEuQNkroPkYw',
    HOME_TIMELINE: 'HCosKfLNW1AcOo3la3mMgg',
    HOME_LATEST_TIMELINE: 'cWF3cqWadLlIXA6KJWhcew',
  },
};

export interface ExtractedUser {
  userId: string;
  screenName: string;
  name: string;
  profileImageUrl?: string;
  isVerified?: boolean;
  isBlueVerified?: boolean;
  followersCount?: number;
  description?: string;
}

export interface FetchResult {
  users: ExtractedUser[];
  nextCursor?: string;
  hasMore: boolean;
  error?: string;
}

/**
 * Build request headers for X API
 */
function buildHeaders(session: Session, userId?: string): Record<string, string> {
  // Build cookie with optional twid (user ID)
  let cookie = `auth_token=${session.authToken}; ct0=${session.csrfToken}`;
  if (userId) {
    cookie += `; twid=u%3A${userId}`;
  }
  
  return {
    'authorization': `Bearer ${API_CONFIG.BEARER_TOKEN}`,
    'x-csrf-token': session.csrfToken,
    'x-twitter-active-user': 'yes',
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-client-language': 'en',
    'content-type': 'application/json',
    'accept': '*/*',
    'accept-language': 'en-GB,en;q=0.5',
    'cache-control': 'no-cache',
    'pragma': 'no-cache',
    'cookie': cookie,
    // Browser fetch metadata headers
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    // User-agent to look like a browser
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    // Referer to indicate we're coming from X
    'referer': 'https://x.com/',
  };
}

/**
 * Extract users from GraphQL timeline response
 */
function extractUsersFromResponse(data: any, endpoint: string): ExtractedUser[] {
  const users: ExtractedUser[] = [];
  const seenIds = new Set<string>();

  try {
    // Navigate to the instructions array - try multiple paths
    let instructions: any[] = [];
    
    // Path for followers/following
    if (data?.data?.user?.result?.timeline?.timeline?.instructions) {
      instructions = data.data.user.result.timeline.timeline.instructions;
    }
    // Path for HomeLatestTimeline
    else if (data?.data?.home?.home_timeline_urt?.instructions) {
      instructions = data.data.home.home_timeline_urt.instructions;
    }
    // Path for viewer (current user)
    else if (data?.data?.viewer?.home_timeline?.timeline?.instructions) {
      instructions = data.data.viewer.home_timeline.timeline.instructions;
    }
    // Alternative timeline structure
    else if (data?.data?.viewer?.timeline?.timeline?.instructions) {
      instructions = data.data.viewer.timeline.timeline.instructions;
    }

    for (const instruction of instructions) {
      // TimelineAddEntries is the common instruction type
      const entries = instruction.entries || instruction?.moduleItems || [];
      
      for (const entry of entries) {
        // Skip cursor entries
        if (entry.entryId?.includes('cursor')) continue;
        
        // Handle user entries (followers/following)
        const userResult = entry?.content?.itemContent?.user_results?.result;
        if (userResult && userResult.rest_id && !seenIds.has(userResult.rest_id)) {
          const user = extractUserFromResult(userResult);
          if (user) {
            seenIds.add(user.userId);
            users.push(user);
          }
        }

        // Handle tweet entries (timeline) - extract tweet author
        // Try multiple paths for tweet results
        let tweetResult = entry?.content?.itemContent?.tweet_results?.result;
        
        // Also try direct content.tweet_results path
        if (!tweetResult) {
          tweetResult = entry?.content?.tweet_results?.result;
        }
        
        if (tweetResult) {
          // Handle TweetWithVisibilityResults wrapper
          const actualTweet = tweetResult.tweet || tweetResult;
          const coreUser = actualTweet.core?.user_results?.result;
          if (coreUser && coreUser.rest_id && !seenIds.has(coreUser.rest_id)) {
            const user = extractUserFromResult(coreUser);
            if (user) {
              seenIds.add(user.userId);
              users.push(user);
            }
          }
          
          // Also try legacy.user path
          const legacyUser = actualTweet.legacy?.user_results?.result;
          if (legacyUser && legacyUser.rest_id && !seenIds.has(legacyUser.rest_id)) {
            const user = extractUserFromResult(legacyUser);
            if (user) {
              seenIds.add(user.userId);
              users.push(user);
            }
          }
        }
        
        // Handle conversation/module items
        const moduleItems = entry?.content?.items || [];
        for (const moduleItem of moduleItems) {
          const itemTweet = moduleItem?.item?.itemContent?.tweet_results?.result;
          if (itemTweet) {
            const actualTweet = itemTweet.tweet || itemTweet;
            const coreUser = actualTweet.core?.user_results?.result;
            if (coreUser && coreUser.rest_id && !seenIds.has(coreUser.rest_id)) {
              const user = extractUserFromResult(coreUser);
              if (user) {
                seenIds.add(user.userId);
                users.push(user);
              }
            }
          }
        }
      }
    }
    
  } catch (error) {
    // Silent fail for user extraction
  }

  return users;
}

/**
 * Extract user data from a GraphQL user result object
 * Updated for X's 2024 API structure where core data moved from legacy to core
 */
function extractUserFromResult(result: any): ExtractedUser | null {
  try {
    // New structure: screen_name and name are in result.core
    const coreData = result.core || {};
    const legacy = result.legacy || {};
    
    // Try new structure first, fall back to legacy
    const screenName = coreData.screen_name || legacy.screen_name;
    if (!screenName) return null;

    // Avatar can be in result.avatar or legacy.profile_image_url_https
    let profileImageUrl = '';
    if (result.avatar?.image_url) {
      profileImageUrl = result.avatar.image_url;
    } else if (legacy.profile_image_url_https) {
      profileImageUrl = legacy.profile_image_url_https;
    }
    
    // Upgrade to larger image
    if (profileImageUrl) {
      profileImageUrl = profileImageUrl.replace('_normal.', '_400x400.');
    }

    return {
      userId: result.rest_id || result.id || result.id_str || '',
      screenName: screenName,
      name: coreData.name || legacy.name || '',
      profileImageUrl,
      isVerified: legacy.verified || result.verification?.is_blue_verified,
      isBlueVerified: result.is_blue_verified,
      followersCount: legacy.followers_count,
      description: result.profile_bio?.description || legacy.description,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Get the currently authenticated user's info
 * NOTE: REST API returns 401, so we need the user to provide their username
 * Then we use UserByScreenName to get the userId
 */
export async function getCurrentUser(session: Session): Promise<{ userId: string; screenName: string } | null> {
  // This function now returns null - we need the user to provide their username
  // and we use getUserId() to look it up
  return null;
}

/**
 * Get user info by screen name (for looking up the logged-in user)
 */
export async function getUserInfo(screenName: string, session: Session): Promise<{ userId: string; screenName: string } | null> {
  try {
    const userId = await getUserId(screenName, session);
    
    if (userId) {
      return { userId, screenName };
    }
    
    return null;
  } catch (error: any) {
    return null;
  }
}

/**
 * Extract cursor for pagination
 */
function extractCursor(data: any): string | undefined {
  try {
    const instructions = 
      data?.data?.user?.result?.timeline?.timeline?.instructions ||
      data?.data?.home?.home_timeline_urt?.instructions ||
      [];

    for (const instruction of instructions) {
      const entries = instruction.entries || [];
      
      for (const entry of entries) {
        if (entry.entryId?.startsWith('cursor-bottom')) {
          return entry.content?.value;
        }
      }
    }
  } catch (error) {
    // Silent fail for cursor extraction
  }
  return undefined;
}

/**
 * Get user ID from screen name
 */
export async function getUserId(screenName: string, session: Session): Promise<string | null> {
  try {
    const variables = {
      screen_name: screenName,
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

    const url = `${API_CONFIG.BASE_URL}/${API_CONFIG.QUERY_IDS.USER_BY_SCREEN_NAME}/UserByScreenName?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.TIMEOUT_MS);

    const response = await fetch(url, {
      method: 'GET',
      headers: buildHeaders(session),
      credentials: 'include',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data?.data?.user?.result?.rest_id || null;
  } catch (error: any) {
    return null;
  }
}

/**
 * Fetch followers for a user
 */
export async function fetchFollowers(
  userId: string,
  session: Session,
  cursor?: string
): Promise<FetchResult> {
  try {

    const variables: any = {
      userId,
      count: 20,
      includePromotedContent: false,
      withGrokTranslatedBio: false,
    };

    if (cursor) {
      variables.cursor = cursor;
    }

    // Features captured from X.com 2024-12-01
    const features = {
      rweb_video_screen_enabled: false,
      profile_label_improvements_pcf_label_in_post_enabled: true,
      responsive_web_profile_redirect_enabled: false,
      rweb_tipjar_consumption_enabled: true,
      verified_phone_label_enabled: false,
      creator_subscriptions_tweet_preview_api_enabled: true,
      responsive_web_graphql_timeline_navigation_enabled: true,
      responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
      premium_content_api_read_enabled: false,
      communities_web_enable_tweet_community_results_fetch: true,
      c9s_tweet_anatomy_moderator_badge_enabled: true,
      responsive_web_grok_analyze_button_fetch_trends_enabled: false,
      responsive_web_grok_analyze_post_followups_enabled: true,
      responsive_web_jetfuel_frame: true,
      responsive_web_grok_share_attachment_enabled: true,
      articles_preview_enabled: true,
      responsive_web_edit_tweet_api_enabled: true,
      graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
      view_counts_everywhere_api_enabled: true,
      longform_notetweets_consumption_enabled: true,
      responsive_web_twitter_article_tweet_consumption_enabled: true,
      tweet_awards_web_tipping_enabled: false,
      responsive_web_grok_show_grok_translated_post: false,
      responsive_web_grok_analysis_button_from_backend: true,
      creator_subscriptions_quote_tweet_preview_enabled: false,
      freedom_of_speech_not_reach_fetch_enabled: true,
      standardized_nudges_misinfo: true,
      tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
      longform_notetweets_rich_text_read_enabled: true,
      longform_notetweets_inline_media_enabled: true,
      responsive_web_grok_image_annotation_enabled: true,
      responsive_web_grok_imagine_annotation_enabled: true,
      responsive_web_grok_community_note_auto_translation_is_enabled: false,
      responsive_web_enhance_cards_enabled: false,
    };

    // Try POST method since GET might be blocked for Followers
    const url = `${API_CONFIG.BASE_URL}/${API_CONFIG.QUERY_IDS.FOLLOWERS}/Followers`;
    
    const body = JSON.stringify({
      variables,
      features,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.TIMEOUT_MS);

    // First try POST
    let response = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(session, userId),
      credentials: 'include',
      signal: controller.signal,
      body,
    });
    
    // If POST fails, fall back to GET
    if (!response.ok) {
      const getUrl = `${url}?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}`;
      response = await fetch(getUrl, {
        method: 'GET',
        headers: buildHeaders(session, userId),
        credentials: 'include',
      });
    }

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { users: [], hasMore: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    const users = extractUsersFromResponse(data, 'followers');
    const nextCursor = extractCursor(data);

    return {
      users,
      nextCursor,
      hasMore: !!nextCursor && users.length > 0,
    };
  } catch (error: any) {
    return { users: [], hasMore: false, error: error.message };
  }
}

/**
 * Fetch following for a user
 */
export async function fetchFollowing(
  userId: string,
  session: Session,
  cursor?: string
): Promise<FetchResult> {
  try {

    const variables: any = {
      userId,
      count: 20,
      includePromotedContent: false,
      withGrokTranslatedBio: false,
    };

    if (cursor) {
      variables.cursor = cursor;
    }

    // Features captured from X.com 2024-12-01
    const features = {
      rweb_video_screen_enabled: false,
      profile_label_improvements_pcf_label_in_post_enabled: true,
      responsive_web_profile_redirect_enabled: false,
      rweb_tipjar_consumption_enabled: true,
      verified_phone_label_enabled: false,
      creator_subscriptions_tweet_preview_api_enabled: true,
      responsive_web_graphql_timeline_navigation_enabled: true,
      responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
      premium_content_api_read_enabled: false,
      communities_web_enable_tweet_community_results_fetch: true,
      c9s_tweet_anatomy_moderator_badge_enabled: true,
      responsive_web_grok_analyze_button_fetch_trends_enabled: false,
      responsive_web_grok_analyze_post_followups_enabled: true,
      responsive_web_jetfuel_frame: true,
      responsive_web_grok_share_attachment_enabled: true,
      articles_preview_enabled: true,
      responsive_web_edit_tweet_api_enabled: true,
      graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
      view_counts_everywhere_api_enabled: true,
      longform_notetweets_consumption_enabled: true,
      responsive_web_twitter_article_tweet_consumption_enabled: true,
      tweet_awards_web_tipping_enabled: false,
      responsive_web_grok_show_grok_translated_post: false,
      responsive_web_grok_analysis_button_from_backend: true,
      creator_subscriptions_quote_tweet_preview_enabled: false,
      freedom_of_speech_not_reach_fetch_enabled: true,
      standardized_nudges_misinfo: true,
      tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
      longform_notetweets_rich_text_read_enabled: true,
      longform_notetweets_inline_media_enabled: true,
      responsive_web_grok_image_annotation_enabled: true,
      responsive_web_grok_imagine_annotation_enabled: true,
      responsive_web_grok_community_note_auto_translation_is_enabled: false,
      responsive_web_enhance_cards_enabled: false,
    };

    const url = `${API_CONFIG.BASE_URL}/${API_CONFIG.QUERY_IDS.FOLLOWING}/Following?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.TIMEOUT_MS);

    const response = await fetch(url, {
      method: 'GET',
      headers: buildHeaders(session),
      credentials: 'include',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { users: [], hasMore: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    const users = extractUsersFromResponse(data, 'following');
    const nextCursor = extractCursor(data);

    return {
      users,
      nextCursor,
      hasMore: !!nextCursor && users.length > 0,
    };
  } catch (error: any) {
    return { users: [], hasMore: false, error: error.message };
  }
}

/**
 * Fetch home timeline (latest)
 */
export async function fetchTimeline(
  session: Session,
  cursor?: string
): Promise<FetchResult> {
  try {

    const variables: any = {
      count: 20,
      includePromotedContent: true,
      latestControlAvailable: true,
      requestContext: 'launch',
      withCommunity: true,
    };

    if (cursor) {
      variables.cursor = cursor;
    }

    // Features captured from X.com 2024-12-01
    const features = {
      rweb_video_screen_enabled: false,
      profile_label_improvements_pcf_label_in_post_enabled: true,
      responsive_web_profile_redirect_enabled: false,
      rweb_tipjar_consumption_enabled: true,
      verified_phone_label_enabled: false,
      creator_subscriptions_tweet_preview_api_enabled: true,
      responsive_web_graphql_timeline_navigation_enabled: true,
      responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
      premium_content_api_read_enabled: false,
      communities_web_enable_tweet_community_results_fetch: true,
      c9s_tweet_anatomy_moderator_badge_enabled: true,
      responsive_web_grok_analyze_button_fetch_trends_enabled: false,
      responsive_web_grok_analyze_post_followups_enabled: true,
      responsive_web_jetfuel_frame: true,
      responsive_web_grok_share_attachment_enabled: true,
      articles_preview_enabled: true,
      responsive_web_edit_tweet_api_enabled: true,
      graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
      view_counts_everywhere_api_enabled: true,
      longform_notetweets_consumption_enabled: true,
      responsive_web_twitter_article_tweet_consumption_enabled: true,
      tweet_awards_web_tipping_enabled: false,
      responsive_web_grok_show_grok_translated_post: false,
      responsive_web_grok_analysis_button_from_backend: true,
      creator_subscriptions_quote_tweet_preview_enabled: false,
      freedom_of_speech_not_reach_fetch_enabled: true,
      standardized_nudges_misinfo: true,
      tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
      longform_notetweets_rich_text_read_enabled: true,
      longform_notetweets_inline_media_enabled: true,
      responsive_web_grok_image_annotation_enabled: true,
      responsive_web_grok_imagine_annotation_enabled: true,
      responsive_web_grok_community_note_auto_translation_is_enabled: false,
      responsive_web_enhance_cards_enabled: false,
    };

    const url = `${API_CONFIG.BASE_URL}/${API_CONFIG.QUERY_IDS.HOME_LATEST_TIMELINE}/HomeLatestTimeline?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.TIMEOUT_MS);

    const response = await fetch(url, {
      method: 'GET',
      headers: buildHeaders(session),
      credentials: 'include',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { users: [], hasMore: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    const users = extractUsersFromResponse(data, 'timeline');
    const nextCursor = extractCursor(data);

    return {
      users,
      nextCursor,
      hasMore: !!nextCursor && users.length > 0,
    };
  } catch (error: any) {
    return { users: [], hasMore: false, error: error.message };
  }
}

/**
 * Fetch blue verified followers for a user
 */
export async function fetchVerifiedFollowers(
  userId: string,
  session: Session,
  cursor?: string
): Promise<FetchResult> {
  try {
    const variables: any = {
      userId,
      count: 20,
      includePromotedContent: false,
      withGrokTranslatedBio: false,
    };

    if (cursor) {
      variables.cursor = cursor;
    }

    // Features captured from X.com 2024-12-01
    const features = {
      rweb_video_screen_enabled: false,
      profile_label_improvements_pcf_label_in_post_enabled: true,
      responsive_web_profile_redirect_enabled: false,
      rweb_tipjar_consumption_enabled: true,
      verified_phone_label_enabled: false,
      creator_subscriptions_tweet_preview_api_enabled: true,
      responsive_web_graphql_timeline_navigation_enabled: true,
      responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
      premium_content_api_read_enabled: false,
      communities_web_enable_tweet_community_results_fetch: true,
      c9s_tweet_anatomy_moderator_badge_enabled: true,
      responsive_web_grok_analyze_button_fetch_trends_enabled: false,
      responsive_web_grok_analyze_post_followups_enabled: true,
      responsive_web_jetfuel_frame: true,
      responsive_web_grok_share_attachment_enabled: true,
      articles_preview_enabled: true,
      responsive_web_edit_tweet_api_enabled: true,
      graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
      view_counts_everywhere_api_enabled: true,
      longform_notetweets_consumption_enabled: true,
      responsive_web_twitter_article_tweet_consumption_enabled: true,
      tweet_awards_web_tipping_enabled: false,
      responsive_web_grok_show_grok_translated_post: false,
      responsive_web_grok_analysis_button_from_backend: true,
      creator_subscriptions_quote_tweet_preview_enabled: false,
      freedom_of_speech_not_reach_fetch_enabled: true,
      standardized_nudges_misinfo: true,
      tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
      longform_notetweets_rich_text_read_enabled: true,
      longform_notetweets_inline_media_enabled: true,
      responsive_web_grok_image_annotation_enabled: true,
      responsive_web_grok_imagine_annotation_enabled: true,
      responsive_web_grok_community_note_auto_translation_is_enabled: false,
      responsive_web_enhance_cards_enabled: false,
    };

    const url = `${API_CONFIG.BASE_URL}/${API_CONFIG.QUERY_IDS.BLUE_VERIFIED_FOLLOWERS}/BlueVerifiedFollowers?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.TIMEOUT_MS);

    const response = await fetch(url, {
      method: 'GET',
      headers: buildHeaders(session),
      credentials: 'include',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return { users: [], hasMore: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    const users = extractUsersFromResponse(data, 'verified_followers');
    const nextCursor = extractCursor(data);

    return {
      users,
      nextCursor,
      hasMore: !!nextCursor && users.length > 0,
    };
  } catch (error: any) {
    return { users: [], hasMore: false, error: error.message };
  }
}

/**
 * Get username by user ID using GraphQL
 */
export async function getUsernameById(userId: string, session: Session): Promise<string | null> {
  try {
    
    // Use UserByRestId endpoint
    const variables = {
      userId,
      withSafetyModeUserFields: true,
    };

    const features = {
      hidden_profile_subscriptions_enabled: true,
      rweb_tipjar_consumption_enabled: true,
      responsive_web_graphql_exclude_directive_enabled: true,
      verified_phone_label_enabled: false,
      subscriptions_verification_info_is_identity_verified_enabled: true,
      responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
      responsive_web_graphql_timeline_navigation_enabled: true,
    };

    // UserByRestId query ID (common X endpoint)
    const queryId = 'xX4NL9fSj4wNqnR-M9TXfQ';
    const url = `${API_CONFIG.BASE_URL}/${queryId}/UserByRestId?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.TIMEOUT_MS);

    const response = await fetch(url, {
      method: 'GET',
      headers: buildHeaders(session),
      credentials: 'include',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    
    // Extract screen_name from response
    const result = data?.data?.user?.result;
    if (result) {
      // Try new structure first (core.screen_name)
      const screenName = result.core?.screen_name || result.legacy?.screen_name;
      if (screenName) {
        return screenName;
      }
    }
    
    return null;
  } catch (error: any) {
    return null;
  }
}

export default {
  getCurrentUser,
  getUserId,
  getUsernameById,
  fetchFollowers,
  fetchVerifiedFollowers,
  fetchFollowing,
  fetchTimeline,
};