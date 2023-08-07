/**
 * Override any properties in the left type with matching properties in the right type.
 */
export type Override<Left, Right> = Omit<Left, keyof Right> & Right
