import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Onboarding from '../Onboarding'

describe('Onboarding Component', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('should display onboarding modal when visible', () => {
    render(<Onboarding isVisible={true} onClose={vi.fn()} />)
    expect(screen.getByText('Welcome to SwiftRemit')).toBeInTheDocument()
  })

  it('should not display onboarding if already seen', () => {
    const onClose = vi.fn()
    localStorage.setItem('swiftremit_onboarding_seen', 'true')
    render(<Onboarding isVisible={true} onClose={onClose} />)
    // onClose should have been called when localStorage was already set
    expect(onClose).toHaveBeenCalled()
  })

  describe('Step navigation', () => {
    it('should advance to next step when Next is clicked', () => {
      render(<Onboarding isVisible={true} onClose={vi.fn()} />)
      fireEvent.click(screen.getByText('Next'))
      expect(screen.getByText('Connect Your Wallet')).toBeInTheDocument()
    })

    it('should navigate through all steps', () => {
      render(<Onboarding isVisible={true} onClose={vi.fn()} />)
      
      fireEvent.click(screen.getByText('Next')) // Step 2
      expect(screen.getByText('Connect Your Wallet')).toBeInTheDocument()
      
      fireEvent.click(screen.getByText('Next')) // Step 3
      expect(screen.getByText('Fund Your Wallet')).toBeInTheDocument()
      
      fireEvent.click(screen.getByText('Next')) // Step 4
      expect(screen.getByText('Send Your First Remittance')).toBeInTheDocument()
    })

    it('should show Get Started button on final step', () => {
      render(<Onboarding isVisible={true} onClose={vi.fn()} />)
      
      for (let i = 0; i < 4; i++) {
        fireEvent.click(screen.getByText('Next'))
      }
      
      expect(screen.getByText('Get Started')).toBeInTheDocument()
    })
  })

  describe('Skip functionality', () => {
    it('should close onboarding when Skip is clicked', () => {
      const onClose = vi.fn()
      render(<Onboarding isVisible={true} onClose={onClose} />)
      fireEvent.click(screen.getByText('Skip'))
      expect(localStorage.getItem('swiftremit_onboarding_seen')).toBe('true')
    })

    it('should close onboarding when close button is clicked', () => {
      const onClose = vi.fn()
      render(<Onboarding isVisible={true} onClose={onClose} />)
      fireEvent.click(screen.getByLabelText('Close onboarding'))
      expect(localStorage.getItem('swiftremit_onboarding_seen')).toBe('true')
    })
  })

  describe('Content and links', () => {
    it('should display step counter', () => {
      render(<Onboarding isVisible={true} onClose={vi.fn()} />)
      expect(screen.getByText('Step 1 of 5')).toBeInTheDocument()
    })

    it('should display documentation link', () => {
      render(<Onboarding isVisible={true} onClose={vi.fn()} />)
      const docsLink = screen.getByRole('link', { name: /📖 Docs/i })
      expect(docsLink).toHaveAttribute('href', 'https://swiftremit.stellar.org/docs')
    })

    it('should display external link on wallet step', () => {
      render(<Onboarding isVisible={true} onClose={vi.fn()} />)
      fireEvent.click(screen.getByText('Next')) // Go to Connect Wallet step
      const walletLink = screen.getByRole('link', { name: /Learn more/ })
      expect(walletLink).toHaveAttribute('href', 'https://www.freighter.app/')
    })

    it('should display emojis for visual guidance', () => {
      render(<Onboarding isVisible={true} onClose={vi.fn()} />)
      expect(screen.getByText('🎉')).toBeInTheDocument()
      fireEvent.click(screen.getByText('Next'))
      expect(screen.getByText('💼')).toBeInTheDocument()
    })
  })

  describe('Completion flow', () => {
    it('should mark onboarding complete when Get Started is clicked', () => {
      const onClose = vi.fn()
      render(<Onboarding isVisible={true} onClose={onClose} />)
      
      for (let i = 0; i < 4; i++) {
        fireEvent.click(screen.getByText('Next'))
      }
      
      fireEvent.click(screen.getByText('Get Started'))
      expect(localStorage.getItem('swiftremit_onboarding_seen')).toBe('true')
    })
  })

  describe('Visibility toggling', () => {
    it('should show when isVisible is true and onboarding not seen', () => {
      const { rerender } = render(<Onboarding isVisible={false} onClose={vi.fn()} />)
      expect(screen.queryByText('Welcome to SwiftRemit')).not.toBeInTheDocument()
      
      rerender(<Onboarding isVisible={true} onClose={vi.fn()} />)
      expect(screen.getByText('Welcome to SwiftRemit')).toBeInTheDocument()
    })

    it('should call onClose callback when modal closes', () => {
      const onClose = vi.fn()
      render(<Onboarding isVisible={true} onClose={onClose} />)
      fireEvent.click(screen.getByText('Skip'))
      expect(onClose).toHaveBeenCalled()
    })
  })
})
