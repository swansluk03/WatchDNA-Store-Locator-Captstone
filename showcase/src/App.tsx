import Navigation from './components/Navigation';
import Hero from './components/Hero';
import Overview from './components/Overview';
import Architecture from './components/Architecture';
import Pipeline from './components/Pipeline';
import Team from './components/Team';
import Stack from './components/Stack';
import Footer from './components/Footer';

export default function App() {
  return (
    <div className="min-h-screen bg-bg text-fg">
      <Navigation />
      <main>
        <Hero />
        <Overview />
        <Architecture />
        <Pipeline />
        <Team />
        <Stack />
      </main>
      <Footer />
    </div>
  );
}
