/**
 * Discord application that owns the activity card. The portal name is what the
 * profile reads as "Listening to …", so it lives in Discord, not in the code.
 * The public key is *not* used: that one is only needed for bot interactions.
 */
export const DISCORD_CLIENT_ID = '1566704116443648090'

/**
 * Art asset key from *Rich Presence → Art Assets*. Leave empty to send the card
 * without an image. A wrong key is harmless — Discord just draws no picture.
 */
export const DISCORD_ASSET_KEY = 'icon'

/** Tooltip on the artwork when the player does not expose its own name. */
export const DISCORD_FALLBACK_APP = 'Dynamic Island KW'
