/**
 * Nitro reads this setting when starting Bun. Library resolution can legitimately exceed
 * Bun's short default HTTP idle timeout, so keep the request open until its result is returned.
 */
export default function configureBunHttpTimeout(): void {
  process.env.NITRO_BUN_IDLE_TIMEOUT ??= "180"
}
