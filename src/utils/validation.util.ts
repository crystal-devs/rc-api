// utils/validation.util.ts
// ====================================
// Centralized validation utilities

export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Email validation
 */
export const validateEmail = (email: string): ValidationResult => {
  if (!email || typeof email !== 'string') {
    return { isValid: false, error: 'Email is required' };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    return { isValid: false, error: 'Invalid email format' };
  }

  return { isValid: true };
};

/**
 * Phone number validation
 */
export const validatePhoneNumber = (phone: string): ValidationResult => {
  if (!phone || typeof phone !== 'string') {
    return { isValid: false, error: 'Phone number is required' };
  }

  const phoneRegex = /^\+?[1-9]\d{1,14}$/;
  if (!phoneRegex.test(phone.trim())) {
    return { isValid: false, error: 'Invalid phone number format' };
  }

  return { isValid: true };
};

/**
 * Provider validation for social login
 */
export const validateProvider = (provider: string): ValidationResult => {
  if (!provider || typeof provider !== 'string') {
    return { isValid: false, error: 'Provider is required' };
  }

  const validProviders = ['google', 'apple', 'instagram', 'facebook', 'email'];
  if (!validProviders.includes(provider.trim().toLowerCase())) {
    return { isValid: false, error: 'Invalid provider' };
  }

  return { isValid: true };
};

/**
 * Name validation
 */
export const validateName = (name: string): ValidationResult => {
  if (!name || typeof name !== 'string') {
    return { isValid: false, error: 'Name is required' };
  }

  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 100) {
    return { isValid: false, error: 'Name must be between 1 and 100 characters' };
  }

  return { isValid: true };
};

/**
 * URL validation
 */
export const validateUrl = (url: string): ValidationResult => {
  if (!url || typeof url !== 'string') {
    return { isValid: false, error: 'URL is required' };
  }

  try {
    new URL(url.trim());
    return { isValid: true };
  } catch {
    return { isValid: false, error: 'Invalid URL format' };
  }
};

/**
 * Password validation
 */
export const validatePassword = (password: string): ValidationResult => {
  if (!password || typeof password !== 'string') {
    return { isValid: false, error: 'Password is required' };
  }

  if (password.length < 8) {
    return { isValid: false, error: 'Password must be at least 8 characters long' };
  }

  // Check for basic complexity (optional - adjust as needed)
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumbers = /\d/.test(password);

  if (!hasUpperCase || !hasLowerCase || !hasNumbers) {
    return {
      isValid: false,
      error: 'Password must contain at least one uppercase letter, one lowercase letter, and one number'
    };
  }

  return { isValid: true };
};

/**
 * Combined validation for login credentials
 */
export const validateLoginCredentials = (data: {
  email?: string;
  phone_number?: string;
  provider?: string;
  password?: string;
}): ValidationResult => {
  const { email, phone_number, provider, password } = data;

  // Check if either email or phone is provided
  if (!email && !phone_number) {
    return { isValid: false, error: 'Either email or phone number is required' };
  }

  // Validate email if provided
  if (email) {
    const emailValidation = validateEmail(email);
    if (!emailValidation.isValid) return emailValidation;
  }

  // Validate phone if provided
  if (phone_number) {
    const phoneValidation = validatePhoneNumber(phone_number);
    if (!phoneValidation.isValid) return phoneValidation;
  }

  // Validate provider
  if (provider) {
    const providerValidation = validateProvider(provider);
    if (!providerValidation.isValid) return providerValidation;
  }

  // Validate password for email login
  if (password) {
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) return passwordValidation;
  }

  return { isValid: true };
};

/**
 * Combined validation for registration
 */
export const validateRegistrationData = (data: {
  name: string;
  email: string;
  password?: string;
  provider?: string;
}): ValidationResult => {
  const { name, email, password, provider } = data;

  // Validate name
  const nameValidation = validateName(name);
  if (!nameValidation.isValid) return nameValidation;

  // Validate email
  const emailValidation = validateEmail(email);
  if (!emailValidation.isValid) return emailValidation;

  // Validate password if provided (for email registration)
  if (password) {
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) return passwordValidation;
  }

  // Validate provider if provided
  if (provider) {
    const providerValidation = validateProvider(provider);
    if (!providerValidation.isValid) return providerValidation;
  }

  return { isValid: true };
};