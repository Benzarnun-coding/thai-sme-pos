import '@testing-library/jest-dom'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Mock resizeTo since it's not available in JSDOM
window.resizeTo = function (width, height) {
  Object.assign(this, {
    innerWidth: width,
    innerHeight: height,
    outerWidth: width,
    outerHeight: height,
  }).dispatchEvent(new this.Event('resize'));
};

// Set default desktop size
window.resizeTo(1200, 800);

afterEach(() => {
  cleanup()
})
