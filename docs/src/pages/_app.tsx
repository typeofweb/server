import type { AppComponent } from 'next/dist/next-server/lib/router/router';

import '../styles/globals.scss';
import '../styles/prism.css';

const App: AppComponent = ({ Component, pageProps }) => {
  return <Component {...pageProps} />;
};

export default App;
