'use strict';

/**
 * Determine if the given value is "blank".
 *
 * @param  value
 * @return boolean
 */
const blank = function blank(value) {
  if (value instanceof Error) {
    return false;
  }

  if (typeof value === 'undefined') {
    return true;
  }

  if (value === null) {
    return true;
  }

  if (typeof value === 'string') {
    return value.trim() === '';
  }

  if (typeof value === 'boolean' || typeof value === 'number') {
    return false;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  if (typeof value === 'object') {
    return Object.keys(value).length === 0;
  }

  if (typeof value === 'function') {
    return false;
  }

  return false;
};

/**
 * Recursively remove `null` and `undefined` values from object.
 */
const clean = function clean(value) {
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((v) => ((v && typeof v === 'object') ? clean(v) : v))
      .filter((v) => !(v == null));
  }

  return Object.entries(value)
    .map(([k, v]) => [k, v && typeof v === 'object' ? clean(v) : v])
    // eslint-disable-next-line no-return-assign
    .reduce((a, [k, v]) => (v == null ? a : (a[k] = v, a)), {});
};

/**
 * Determine if the given value is "filled".
 *
 * @param  value
 * @return boolean
 */
const filled = function filled(value) {
  return !blank(value);
};

module.exports.blank = blank;
module.exports.clean = clean;
module.exports.filled = filled;
