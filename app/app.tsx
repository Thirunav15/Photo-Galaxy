import { ThemeProvider } from './cmps/layout'
import { Button } from './cmps/ui/button'
import PrimaryViews from './cmps/views'
import { Intro } from './cmps/views/intro'
import { useShallowState } from './store'

const App = () => {
  const { error, retry } = useShallowState((state) => ({
    error: state.photoStorageError,
    retry: state.retryPhotoStorage,
  }))

  return (
    <ThemeProvider>
      {error ? (
        <div
          role='alert'
          className='fixed inset-x-4 top-4 z-[100] mx-auto flex max-w-2xl items-center justify-between gap-4 rounded-xl border border-rose-300/20 bg-[#181818] p-4 text-sm text-white shadow-xl'
        >
          <span>{error} The old saved gallery has been kept.</span>
          <Button
            type='button'
            variant='outline'
            onClick={() => void retry()}
            className='shrink-0'
          >
            Retry
          </Button>
        </div>
      ) : null}
      <PrimaryViews />
      <Intro />
    </ThemeProvider>
  )
}

export default App
