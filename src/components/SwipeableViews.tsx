import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useSwipeable } from 'react-swipeable';

interface SwipeableViewsProps {
  children: React.ReactNode[];
  routes: string[];
  onIndexChange?: (index: number) => void;
}

export const SwipeableViews: React.FC<SwipeableViewsProps> = ({ 
  children, 
  routes,
  onIndexChange 
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Sync index with current route
  useEffect(() => {
    const routeIndex = routes.findIndex(route => location.pathname === route);
    if (routeIndex !== -1 && routeIndex !== currentIndex) {
      setCurrentIndex(routeIndex);
    }
  }, [location.pathname, routes, currentIndex]);

  const navigateToIndex = (index: number) => {
    if (index < 0 || index >= routes.length || isTransitioning) return;
    
    setIsTransitioning(true);
    setCurrentIndex(index);
    navigate(routes[index]);
    onIndexChange?.(index);
    
    setTimeout(() => {
      setIsTransitioning(false);
    }, 300);
  };

  const handlers = useSwipeable({
    onSwipedLeft: () => {
      if (currentIndex < routes.length - 1) {
        navigateToIndex(currentIndex + 1);
      }
    },
    onSwipedRight: () => {
      if (currentIndex > 0) {
        navigateToIndex(currentIndex - 1);
      }
    },
    trackMouse: false,
    trackTouch: true,
    delta: 50
  });

  return (
    <div 
      {...handlers}
      className="relative w-full h-full overflow-hidden touch-pan-y"
    >
      <div 
        className="flex h-full transition-transform duration-300 ease-out"
        style={{ 
          transform: `translateX(-${currentIndex * 100}%)`,
          width: `${routes.length * 100}%`
        }}
      >
        {children.map((child, index) => (
          <div 
            key={routes[index]} 
            className="w-full h-full flex-shrink-0 overflow-y-auto"
            style={{ width: `${100 / routes.length}%` }}
          >
            {child}
          </div>
        ))}
      </div>
    </div>
  );
};
