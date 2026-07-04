import { useState, useEffect } from 'react'
import './Onboarding.css'

export default function Onboarding({ isVisible, onClose }) {
  const [currentStep, setCurrentStep] = useState(0)
  const [hasSkipped, setHasSkipped] = useState(false)

  useEffect(() => {
    const hasSeenOnboarding = localStorage.getItem('swiftremit_onboarding_seen')
    if (hasSeenOnboarding) {
      onClose()
    }
  }, [onClose])

  const steps = [
    {
      title: 'Welcome to SwiftRemit',
      description: 'Send USDC remittances securely across borders with SwiftRemit built on Stellar Soroban.',
      action: 'Next',
      icon: '🎉'
    },
    {
      title: 'Connect Your Wallet',
      description: 'Start by connecting your Freighter wallet. This securely links your Stellar account.',
      action: 'Next',
      icon: '💼',
      link: 'https://www.freighter.app/'
    },
    {
      title: 'Fund Your Wallet',
      description: 'Add USDC to your wallet. You can use the Stellar SEP-24 onramp to buy USDC with fiat.',
      action: 'Next',
      icon: '💰'
    },
    {
      title: 'Send Your First Remittance',
      description: 'Select a recipient, enter the amount, and confirm the transaction. Your funds are held in escrow until the agent confirms payout.',
      action: 'Next',
      icon: '📤'
    },
    {
      title: 'Track Your Transfer',
      description: 'Monitor your remittance status in real-time. Check transaction history and receive updates.',
      action: 'Get Started',
      icon: '📊'
    }
  ]

  const step = steps[currentStep]

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1)
    } else {
      markOnboardingComplete()
    }
  }

  const handleSkip = () => {
    markOnboardingComplete()
  }

  const markOnboardingComplete = () => {
    localStorage.setItem('swiftremit_onboarding_seen', 'true')
    setHasSkipped(true)
    onClose()
  }

  const handleDocLink = () => {
    window.open('https://swiftremit.stellar.org/docs', '_blank')
  }

  if (!isVisible || hasSkipped) return null

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-modal">
        <div className="onboarding-header">
          <div className="onboarding-progress">
            {steps.map((_, idx) => (
              <div
                key={idx}
                className={`progress-dot ${idx <= currentStep ? 'active' : ''}`}
                aria-label={`Step ${idx + 1} of ${steps.length}`}
              />
            ))}
          </div>
          <button className="onboarding-close" onClick={handleSkip} aria-label="Close onboarding">
            ✕
          </button>
        </div>

        <div className="onboarding-content">
          <div className="onboarding-icon">{step.icon}</div>
          <h2>{step.title}</h2>
          <p>{step.description}</p>

          {step.link && (
            <a href={step.link} target="_blank" rel="noopener noreferrer" className="onboarding-link">
              Learn more →
            </a>
          )}
        </div>

        <div className="onboarding-footer">
          <button className="btn-secondary" onClick={handleSkip}>
            Skip
          </button>
          <div className="onboarding-buttons">
            <a href="https://swiftremit.stellar.org/docs" target="_blank" rel="noopener noreferrer" className="btn-tertiary">
              📖 Docs
            </a>
            <button className="btn-primary" onClick={handleNext}>
              {step.action}
            </button>
          </div>
        </div>

        <div className="onboarding-step-counter">
          Step {currentStep + 1} of {steps.length}
        </div>
      </div>
    </div>
  )
}
