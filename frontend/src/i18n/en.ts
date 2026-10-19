export const en = {
  'language.label': 'Language',
  'common.email': 'Email',
  'common.password': 'Password',
  'common.name': 'Name',
  'common.or': 'or',

  'auth.login.title': 'Login',
  'auth.login.subtitle': 'Access your 9Drive gateway.',
  'auth.login.submit': 'Login',
  'auth.login.submitting': 'Logging in...',
  'auth.login.failed': 'Login failed',
  'auth.login.noAccount': 'No account?',
  'auth.login.registerLink': 'Register',

  'auth.register.title': 'Register',
  'auth.register.subtitle': 'Create your storage gateway account.',
  'auth.register.submit': 'Create Account',
  'auth.register.submitting': 'Creating...',
  'auth.register.failed': 'Register failed',
  'auth.register.captcha': 'Please complete the captcha.',
  'auth.register.hasAccount': 'Already registered?',
  'auth.register.loginLink': 'Login',

  'auth.google.continue': 'Continue with Google',
  'auth.google.continueConnect': 'Continue with Google and connect Drive',
  'auth.google.redirecting': 'Redirecting...',
  'auth.google.loginFailed': 'Google login failed',
  'auth.google.registerFailed': 'Google register failed',

  'error.AUTH_INVALID_CREDENTIALS': 'Invalid email or password.',
  'error.AUTH_EMAIL_TAKEN': 'Email already registered.',
  'error.CAPTCHA_FAILED': 'Captcha verification failed.',
  'error.AUTH_SESSION_EXPIRED': 'Session expired.',
  'error.AUTH_INVALID_TOKEN': 'Invalid token.',
} as const

export type MessageKey = keyof typeof en
export type Messages = Record<MessageKey, string>
