/**
 * X-Posed Community Cache - Cloudflare Worker
 * 
 * This worker provides a shared cache for location/device data.
 * Deploy this to your own Cloudflare account for community caching.
 * 
 * Required KV Namespaces:
 * - CACHE_KV: Main cache storage
 */

// CORS headers for browser extension
const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
};

// Configuration
const CONFIG = {
    MAX_BATCH_SIZE: 100,           // Max usernames per lookup request
    MAX_CONTRIBUTE_BATCH: 500,     // Max entries per contribute request
    ENTRY_TTL_SECONDS: 14 * 24 * 60 * 60, // 2 weeks
    MAX_USERNAME_LENGTH: 50,
    RATE_LIMIT_PER_MINUTE: 120,    // Requests per minute per IP
};

/**
 * Main request handler
 */
export default {
    async fetch(request, env, ctx) {
        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: CORS_HEADERS });
        }

        const url = new URL(request.url);
        const path = url.pathname;

        try {
            // Route handling
            if (path === '/lookup' && request.method === 'GET') {
                return await handleLookup(request, env);
            }
            
            if (path === '/contribute' && request.method === 'POST') {
                return await handleContribute(request, env);
            }
            
            if (path === '/stats' && request.method === 'GET') {
                return await handleStats(env);
            }
            
            if (path === '/cleanup' && request.method === 'POST') {
                return await handleCleanup(request, env);
            }
            
            if (path === '/health') {
                return jsonResponse({ status: 'ok', timestamp: Date.now() });
            }

            return jsonResponse({ error: 'Not found' }, 404);
            
        } catch (error) {
            console.error('Worker error:', error);
            return jsonResponse({ error: 'Internal server error' }, 500);
        }
    }
};

/**
 * Handle lookup requests
 * GET /lookup?users=user1,user2,user3
 */
async function handleLookup(request, env) {
    const url = new URL(request.url);
    const usersParam = url.searchParams.get('users');
    
    if (!usersParam) {
        return jsonResponse({ error: 'Missing users parameter' }, 400);
    }

    // Parse and validate usernames
    const usernames = usersParam
        .split(',')
        .map(u => u.trim().toLowerCase())
        .filter(u => u.length > 0 && u.length <= CONFIG.MAX_USERNAME_LENGTH)
        .slice(0, CONFIG.MAX_BATCH_SIZE);

    if (usernames.length === 0) {
        return jsonResponse({ error: 'No valid usernames provided' }, 400);
    }

    // Batch get from KV
    const results = {};
    const misses = [];

    // KV doesn't have batch get, so we use Promise.all
    const lookups = await Promise.all(
        usernames.map(async username => {
            try {
                const data = await env.CACHE_KV.get(username, 'json');
                return { username, data };
            } catch {
                return { username, data: null };
            }
        })
    );

    for (const { username, data } of lookups) {
        if (data) {
            results[username] = data;
        } else {
            misses.push(username);
        }
    }

    return jsonResponse({
        results,
        misses,
        count: Object.keys(results).length
    });
}

/**
 * Handle contribute requests
 * POST /contribute { entries: { username: { l, d, a } } }
 */
async function handleContribute(request, env) {
    let body;
    
    // Step 1: Parse JSON
    try {
        body = await request.json();
    } catch (parseError) {
        console.error('JSON parse error:', parseError);
        return jsonResponse({ error: 'Invalid JSON', details: parseError.message }, 400);
    }

    // Step 2: Validate entries object exists
    if (!body.entries || typeof body.entries !== 'object') {
        console.error('Missing entries object. Body:', JSON.stringify(body).substring(0, 200));
        return jsonResponse({ error: 'Missing entries object' }, 400);
    }

    // Step 3: Convert to array
    let entries;
    try {
        entries = Object.entries(body.entries);
    } catch (entriesError) {
        console.error('Object.entries error:', entriesError);
        return jsonResponse({ error: 'Invalid entries format', details: entriesError.message }, 400);
    }
    
    if (entries.length === 0) {
        return jsonResponse({ error: 'No entries provided' }, 400);
    }

    if (entries.length > CONFIG.MAX_CONTRIBUTE_BATCH) {
        return jsonResponse({ error: `Max ${CONFIG.MAX_CONTRIBUTE_BATCH} entries per request` }, 400);
    }

    let accepted = 0;
    let rejected = 0;
    const puts = [];

    // Step 4: Process each entry
    for (const [username, data] of entries) {
        try {
            // Validate username
            if (!username || typeof username !== 'string') {
                rejected++;
                continue;
            }
            
            const cleanUsername = username.trim().toLowerCase();
            if (cleanUsername.length === 0 || cleanUsername.length > CONFIG.MAX_USERNAME_LENGTH) {
                rejected++;
                continue;
            }

            // Validate data object exists
            if (!data || typeof data !== 'object') {
                rejected++;
                continue;
            }

            // Extract data - support both formats:
            // Short format: { l, d, a } (from regular contributions and bulk sync)
            // Long format: { location, device, locationAccurate } (legacy)
            const location = data.l || data.location;
            const device = data.d || data.device || '';
            const accurate = data.a !== undefined ? data.a !== false :
                             data.locationAccurate !== undefined ? data.locationAccurate !== false : true;

            // Validate location exists and is a string
            if (!location || typeof location !== 'string' || location.trim().length === 0) {
                rejected++;
                continue;
            }

            // SECURITY: Validate location length to prevent storage exhaustion/abuse
            if (location.length > 100) {
                rejected++;
                continue;
            }

            // SECURITY: Basic XSS prevention (though client should also sanitize)
            if (location.includes('<') || location.includes('>') || location.includes('javascript:')) {
                rejected++;
                continue;
            }

            // SECURITY: Validate device string length
            if (device && (typeof device !== 'string' || device.length > 100)) {
                rejected++;
                continue;
            }
            
            const entry = {
                l: String(location).trim(),               // location
                d: String(device || '').trim(),           // device
                a: Boolean(accurate),                     // accurate
                t: Math.floor(Date.now() / 1000)          // timestamp in seconds
            };

            puts.push(
                env.CACHE_KV.put(cleanUsername, JSON.stringify(entry), {
                    expirationTtl: CONFIG.ENTRY_TTL_SECONDS
                })
            );
            accepted++;
        } catch (entryError) {
            console.error('Entry processing error for', username, ':', entryError);
            rejected++;
        }
    }

    // Step 5: Execute all KV puts
    if (puts.length > 0) {
        try {
            await Promise.all(puts);
        } catch (kvError) {
            console.error('KV put error:', kvError);
            return jsonResponse({
                error: 'Failed to store entries',
                details: kvError.message,
                accepted: 0,
                rejected: entries.length
            }, 500);
        }
    }

    // Step 6: Update stats (fire and forget)
    try {
        updateStats(env, accepted);
    } catch (statsError) {
        console.error('Stats update error:', statsError);
        // Don't fail the request for stats error
    }

    return jsonResponse({
        accepted,
        rejected,
        message: `Stored ${accepted} entries`
    });
}

/**
 * Handle stats request
 */
async function handleStats(env) {
    try {
        // Count actual entries in KV by listing all keys
        let totalEntries = 0;
        let cursor = null;
        
        do {
            const listResult = await env.CACHE_KV.list({
                cursor,
                limit: 1000
            });
            
            // Count entries, excluding the __stats__ key
            totalEntries += listResult.keys.filter(k => k.name !== '__stats__').length;
            cursor = listResult.list_complete ? null : listResult.cursor;
        } while (cursor);
        
        // Get stored stats for contribution history
        const storedStats = await env.CACHE_KV.get('__stats__', 'json') || {
            totalContributions: 0,
            lastUpdated: null
        };
        
        return jsonResponse({
            totalEntries,
            totalContributions: storedStats.totalContributions,
            lastUpdated: storedStats.lastUpdated
        });
    } catch (error) {
        console.error('Stats error:', error);
        return jsonResponse({ error: 'Failed to get stats' }, 500);
    }
}

/**
 * Update contribution stats
 * @param {number} newEntries - Number of new entries added
 */
async function updateStats(env, newEntries) {
    try {
        const stats = await env.CACHE_KV.get('__stats__', 'json') || {
            totalContributions: 0,
            totalEntries: 0
        };
        
        stats.totalContributions += newEntries;
        stats.totalEntries += newEntries; // Approximation: counts all contributions
        stats.lastUpdated = new Date().toISOString();
        
        await env.CACHE_KV.put('__stats__', JSON.stringify(stats));
    } catch (error) {
        console.error('Failed to update stats:', error);
    }
}

/**
 * Handle cleanup of invalid/numeric keys
 * Protected by ADMIN_SECRET
 */
async function handleCleanup(request, env) {
    // SECURITY: Require Admin Secret
    const authHeader = request.headers.get('X-Admin-Secret');
    if (!env.ADMIN_SECRET || authHeader !== env.ADMIN_SECRET) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    try {
        let deleted = 0;
        let cursor = null;
        const invalidKeys = [];
        
        // Find all numeric or invalid keys
        do {
            const listResult = await env.CACHE_KV.list({
                cursor,
                limit: 1000
            });
            
            for (const key of listResult.keys) {
                const name = key.name;
                // Delete keys that are purely numeric (0, 1, 2, etc.)
                if (/^\d+$/.test(name)) {
                    invalidKeys.push(name);
                }
            }
            
            cursor = listResult.list_complete ? null : listResult.cursor;
        } while (cursor);
        
        // Delete invalid keys
        for (const key of invalidKeys) {
            await env.CACHE_KV.delete(key);
            deleted++;
        }
        
        return jsonResponse({
            success: true,
            deleted,
            message: `Cleaned up ${deleted} invalid numeric keys`
        });
    } catch (error) {
        console.error('Cleanup error:', error);
        return jsonResponse({ error: 'Cleanup failed', details: error.message }, 500);
    }
}

/**
 * JSON response helper
 */
function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS
        }
    });
}