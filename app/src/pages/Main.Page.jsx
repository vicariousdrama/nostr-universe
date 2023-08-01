import React, { useState } from "react";
import { Header } from "../layout/Header";
import { TrendingProfiles } from "../components/trending-profiles/TrendingProfiles";
import { db } from "../db";
import { AppsList } from "../components/apps/AppsList";
import { EditKeyModal } from "../components/edit-key-modal/EditKeyModal";
import { SearchModal } from "../components/search-modal/SearchModal";
import { PinAppModal } from "../components/pin-app-modal/PinAppModal";
import { Footer } from "../layout/Footer";
import { styled } from "@mui/material";

const MainPage = () => {
  const [isSearchModalVisible, setIsSearchModalVisible] = useState(false);
  const toggleSearchModalVisibility = () => {
    setIsSearchModalVisible((prevState) => !prevState);
  };

  const [isEditKeyModalVisible, setIsEditKeyModalVisible] = useState(false);
  const toggleEditKeyModalVisibility = () => {
    setIsEditKeyModalVisible((prevState) => !prevState);
  };

  const [isPinModalVisible, setIsPinModalVisible] = useState(false);
  const togglePinModalVisibility = () => {
    setIsPinModalVisible((prevState) => !prevState);
  };
  return (
    <Container>
      <Header
        onOpenSearchModal={toggleSearchModalVisibility}
        onOpenEditKeyModal={toggleEditKeyModalVisibility}
      />
      <main>
        {false && <button onClick={() => db.delete()}>Delete DB</button>}

        <TrendingProfiles />

        {true && <AppsList />}

        <EditKeyModal
          isOpen={isEditKeyModalVisible}
          onClose={toggleEditKeyModalVisibility}
        />

        <SearchModal
          isOpen={isSearchModalVisible}
          onClose={toggleSearchModalVisibility}
        />

        <PinAppModal
          isOpen={isPinModalVisible}
          onClose={togglePinModalVisibility}
        />
      </main>
      <Footer onOpenPinModal={togglePinModalVisibility} />
    </Container>
  );
};

const Container = styled("div")`
  height: 100%;
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: auto 1fr auto;
  grid-template-areas:
    "header"
    "main"
    "footer";

  & > header {
    grid-area: header;
  }

  & > main {
    grid-area: main;
    overflow: auto;
    padding: 15px 5px 10px 5px;
  }

  & > footer {
    grid-area: footer;
    overflow: auto;
    scrollbar-width: thin;
  }
`;

export default MainPage;
