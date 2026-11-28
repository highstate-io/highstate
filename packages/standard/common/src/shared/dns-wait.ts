import { type Input, interpolate, type Output } from "@highstate/pulumi"

/**
 * Builds a bounded propagation check for a DNS name and, optionally, its exact address.
 */
export function getDnsWaitScript(name: Input<string>, value?: Input<string>): Output<string> {
  const lookup =
    value === undefined
      ? interpolate`getent hosts "${name}"`
      : interpolate`getent hosts "${name}" | awk '{print $1}' | grep -F -x -- "${value}"`

  return interpolate`attempt=0; while ! ${lookup}; do
    attempt=$((attempt + 1));
    if [ "$attempt" -ge 60 ]; then echo "DNS propagation timed out for ${name}" >&2; exit 1; fi;
    sleep 5;
  done`
}
