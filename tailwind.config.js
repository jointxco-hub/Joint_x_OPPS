/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        inter: ['var(--font-inter)'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xl: '1rem',
        '2xl': '1.25rem',
        '3xl': '1.5rem',
      },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))'
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))'
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))'
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))'
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))'
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))'
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))'
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
        info: 'hsl(var(--info))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))'
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background))',
          foreground: 'hsl(var(--sidebar-foreground))',
          primary: 'hsl(var(--sidebar-primary))',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border: 'hsl(var(--sidebar-border))',
          ring: 'hsl(var(--sidebar-ring))'
        }
      },
      boxShadow: {
        'apple-sm': '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        'apple': '0 4px 16px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04)',
        'apple-lg': '0 8px 32px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.06)',
        'apple-xl': '0 20px 60px rgba(0,0,0,0.12), 0 4px 16px rgba(0,0,0,0.08)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' }
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' }
        },
        'slide-in-right': {
          from: { transform: 'translateX(100%)', opacity: '0' },
          to: { transform: 'translateX(0)', opacity: '1' }
        },
        'slide-in-up': {
          from: { transform: 'translateY(20px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' }
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' }
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'slide-in-right': 'slide-in-right 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
        'slide-in-up': 'slide-in-up 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
        'fade-in': 'fade-in 0.2s ease-out',
      }
    }
  },
  safelist: [
    'bg-blue-50', 'bg-blue-100', 'bg-blue-500', 'text-blue-600', 'text-blue-700', 'border-blue-200',
    'bg-green-50', 'bg-green-100', 'bg-green-500', 'text-green-600', 'text-green-700', 'border-green-200',
    'bg-orange-50', 'bg-orange-100', 'bg-orange-500', 'text-orange-600', 'text-orange-700', 'border-orange-200',
    'bg-purple-50', 'bg-purple-100', 'bg-purple-500', 'text-purple-600', 'text-purple-700', 'border-purple-200',
    'bg-red-50', 'bg-red-100', 'bg-red-500', 'text-red-600', 'text-red-700', 'border-red-200',
    'bg-yellow-50', 'bg-yellow-100', 'bg-yellow-500', 'text-yellow-600', 'text-yellow-700', 'border-yellow-200',
    'bg-pink-50', 'bg-pink-100', 'bg-pink-500', 'text-pink-600', 'text-pink-700', 'border-pink-200',
    'bg-indigo-50', 'bg-indigo-100', 'bg-indigo-500', 'text-indigo-600', 'text-indigo-700', 'border-indigo-200',
    'bg-teal-50', 'bg-teal-100', 'bg-teal-500', 'text-teal-600', 'text-teal-700', 'border-teal-200',
    'bg-cyan-50', 'bg-cyan-100', 'bg-cyan-500', 'text-cyan-600', 'text-cyan-700', 'border-cyan-200',
    'bg-slate-50', 'bg-slate-100', 'bg-slate-500', 'text-slate-600', 'text-slate-700', 'border-slate-200',
  ],
  plugins: [require("tailwindcss-animate")],
}
